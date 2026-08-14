import {
  ColorFlag,
  DIFSECT,
  DIRECTORY_ENTRY_SIZE,
  ENDOFCHAIN,
  FATSECT,
  FREESECT,
  HEADER_DIFAT_ENTRIES,
  HEADER_SIZE,
  NOSTREAM,
  ObjectType,
  SIGNATURE,
} from './constants.js'
import { compareEntryNames } from './names.js'
import { CfbError } from './reader.js'
import type { CfbInput } from './types.js'

const MINI_SECTOR_SIZE = 64
const MINI_STREAM_CUTOFF = 4096

interface Node {
  name: string
  path: string
  type: ObjectType
  content: Uint8Array
  children: Node[]
  /** 디렉터리 항목 오프셋 +80에 쓰는 16바이트. 생략하면 전부 0. */
  clsid?: Uint8Array
  /** 배치 과정에서 배정된다. */
  id: number
  left: number
  right: number
  child: number
  color: ColorFlag
  startSector: number
  size: number
}

/**
 * 스트림을 복합 파일 바이너리 컨테이너로 직렬화한다.
 *
 * 스트림은 전체 경로를 키로 한다. 중간 저장소는 자동으로 만들어지므로
 * `{ 'BodyText/Section0': data }`는 `Section0` 스트림을 담은 `BodyText`
 * 저장소를 만들어낸다.
 */
export function write(input: CfbInput): Uint8Array {
  const majorVersion = input.majorVersion ?? 3
  const sectorShift = majorVersion === 4 ? 12 : 9
  const sectorSize = 1 << sectorShift
  const fatEntriesPerSector = sectorSize / 4
  const difatEntriesPerSector = fatEntriesPerSector - 1

  const root = buildTree(input)
  const nodes: Node[] = []
  collect(root, nodes)
  assignIds(root, nodes)

  // ---- 섹터 할당 ----------------------------------------------------------
  const sectors: Uint8Array[] = []
  const fat: number[] = []

  const allocate = (data: Uint8Array): number => {
    if (data.length === 0) return ENDOFCHAIN
    const count = Math.ceil(data.length / sectorSize)
    const start = sectors.length
    for (let i = 0; i < count; i++) {
      const chunk = new Uint8Array(sectorSize)
      chunk.set(data.subarray(i * sectorSize, Math.min((i + 1) * sectorSize, data.length)))
      sectors.push(chunk)
      fat.push(start + i + 1)
    }
    fat[start + count - 1] = ENDOFCHAIN
    return start
  }

  // 큰 스트림은 자기 FAT 체인을 갖고, 작은 것은 미니 스트림으로 들어간다.
  const miniChunks: Uint8Array[] = []
  const miniFat: number[] = []
  let miniSectorCount = 0

  for (const node of nodes) {
    if (node.type !== ObjectType.Stream) {
      // MS-CFB §2.6.1: 저장소 개체는 시작 섹터 위치와 스트림 크기 둘 다
      // "반드시 전부 0으로 설정해야 한다". 루트 저장소만 예외다. 미니
      // 스트림을 소유하고, 그 두 필드는 아래에서 덮어쓴다.

      node.startSector = 0
      node.size = 0
      continue
    }
    node.size = node.content.length
    if (node.content.length === 0) {
      node.startSector = ENDOFCHAIN
    } else if (node.content.length < MINI_STREAM_CUTOFF) {
      const count = Math.ceil(node.content.length / MINI_SECTOR_SIZE)
      node.startSector = miniSectorCount
      for (let i = 0; i < count; i++) {
        const chunk = new Uint8Array(MINI_SECTOR_SIZE)
        chunk.set(
          node.content.subarray(
            i * MINI_SECTOR_SIZE,
            Math.min((i + 1) * MINI_SECTOR_SIZE, node.content.length),
          ),
        )
        miniChunks.push(chunk)
        miniFat.push(miniSectorCount + i + 1)
      }
      miniSectorCount += count
      miniFat[miniSectorCount - 1] = ENDOFCHAIN
    } else {
      node.startSector = allocate(node.content)
    }
  }

  // 미니 스트림 자체는 루트가 소유하는 평범한 스트림으로 저장된다.
  const miniStream = concat(miniChunks)
  const miniStreamStart = allocate(miniStream)

  // 미니 FAT도 마찬가지로 평범한 체인이다.
  let miniFatStart = ENDOFCHAIN
  let miniFatSectorCount = 0
  if (miniFat.length > 0) {
    const padded = Math.ceil(miniFat.length / fatEntriesPerSector) * fatEntriesPerSector
    const bytes = new Uint8Array(padded * 4)
    const dv = new DataView(bytes.buffer)
    for (let i = 0; i < padded; i++) {
      dv.setUint32(i * 4, i < miniFat.length ? miniFat[i]! : FREESECT, true)
    }
    miniFatStart = allocate(bytes)
    miniFatSectorCount = bytes.length / sectorSize
  }

  // ---- 디렉터리 ----------------------------------------------------------
  root.startSector = miniStreamStart
  root.size = miniStream.length

  const dirEntriesPerSector = sectorSize / DIRECTORY_ENTRY_SIZE
  const dirEntryCount = Math.ceil(nodes.length / dirEntriesPerSector) * dirEntriesPerSector
  const dirBytes = new Uint8Array(dirEntryCount * DIRECTORY_ENTRY_SIZE)
  const dirView = new DataView(dirBytes.buffer)

  for (let i = 0; i < dirEntryCount; i++) {
    const base = i * DIRECTORY_ENTRY_SIZE
    const node = nodes[i]
    if (!node) {
      // 쓰지 않는 칸도 형태는 갖춰야 한다. 이름 없음, 형제 없음.
      dirView.setUint32(base + 68, NOSTREAM, true)
      dirView.setUint32(base + 72, NOSTREAM, true)
      dirView.setUint32(base + 76, NOSTREAM, true)
      continue
    }
    writeDirEntry(dirBytes, dirView, base, node, majorVersion)
  }

  const dirStart = allocate(dirBytes)
  const dirSectorCount = dirBytes.length / sectorSize

  // ---- FAT / DIFAT 크기 잡기 (고정점) -------------------------------------
  let numFatSectors = 0
  let numDifatSectors = 0
  for (let guard = 0; guard < 64; guard++) {
    const total = sectors.length + numFatSectors + numDifatSectors
    const nf = Math.max(1, Math.ceil(total / fatEntriesPerSector))
    const nd = nf <= HEADER_DIFAT_ENTRIES ? 0 : Math.ceil((nf - HEADER_DIFAT_ENTRIES) / difatEntriesPerSector)
    if (nf === numFatSectors && nd === numDifatSectors) break
    numFatSectors = nf
    numDifatSectors = nd
  }

  const fatSectorIds: number[] = []
  for (let i = 0; i < numFatSectors; i++) {
    fatSectorIds.push(sectors.length)
    sectors.push(new Uint8Array(sectorSize))
    fat.push(FATSECT)
  }
  const difatSectorIds: number[] = []
  for (let i = 0; i < numDifatSectors; i++) {
    difatSectorIds.push(sectors.length)
    sectors.push(new Uint8Array(sectorSize))
    fat.push(DIFSECT)
  }

  // ---- FAT 내보내기 -------------------------------------------------------
  const fatCapacity = numFatSectors * fatEntriesPerSector
  for (let i = 0; i < numFatSectors; i++) {
    const sector = sectors[fatSectorIds[i]!]!
    const dv = new DataView(sector.buffer, sector.byteOffset, sector.byteLength)
    for (let j = 0; j < fatEntriesPerSector; j++) {
      const index = i * fatEntriesPerSector + j
      dv.setUint32(j * 4, index < fat.length ? fat[index]! : FREESECT, true)
    }
  }
  if (fat.length > fatCapacity) {
    throw new CfbError(`FAT sizing failed: ${fat.length} entries do not fit in ${fatCapacity}`)
  }

  // ---- DIFAT 내보내기 -----------------------------------------------------
  const headerDifat = fatSectorIds.slice(0, HEADER_DIFAT_ENTRIES)
  let remaining = fatSectorIds.slice(HEADER_DIFAT_ENTRIES)
  for (let i = 0; i < numDifatSectors; i++) {
    const sector = sectors[difatSectorIds[i]!]!
    const dv = new DataView(sector.buffer, sector.byteOffset, sector.byteLength)
    for (let j = 0; j < difatEntriesPerSector; j++) {
      dv.setUint32(j * 4, remaining[j] ?? FREESECT, true)
    }
    const next = difatSectorIds[i + 1]
    dv.setUint32(difatEntriesPerSector * 4, next ?? ENDOFCHAIN, true)
    remaining = remaining.slice(difatEntriesPerSector)
  }

  // ---- 헤더 ---------------------------------------------------------------
  // 헤더는 512바이트지만 첫 섹터 전체를 차지한다. 섹터 번호가 바이트 오프셋
  // `(sector + 1) * sectorSize`로 대응되기 때문이다. 따라서 버전 4 파일은
  // 헤더 뒤에 3584바이트의 0 패딩을 갖고, 섹터 0이 512가 아니라 4096에서
  // 시작한다.
  const out = new Uint8Array(sectorSize + sectors.length * sectorSize)
  const header = new DataView(out.buffer, 0, HEADER_SIZE)
  // 바이트 8–23은 헤더 CLSID이고 MS-CFB가 0을 요구한다. 루트 저장소의 클래스
  // id는 디렉터리 항목 필드이고 writeDirEntry가 쓴다. 둘을 혼동하지 말 것.

  out.set(SIGNATURE, 0)
  header.setUint16(24, 0x003e, true) // minor version
  header.setUint16(26, majorVersion, true)
  header.setUint16(28, 0xfffe, true) // little-endian marker
  header.setUint16(30, sectorShift, true)
  header.setUint16(32, 6, true) // mini sector shift: 64 bytes
  header.setUint32(40, majorVersion === 4 ? dirSectorCount : 0, true)
  header.setUint32(44, numFatSectors, true)
  header.setUint32(48, dirStart, true)
  header.setUint32(52, 0, true) // transaction signature
  header.setUint32(56, MINI_STREAM_CUTOFF, true)
  header.setUint32(60, miniFatStart, true)
  header.setUint32(64, miniFatSectorCount, true)
  header.setUint32(68, difatSectorIds[0] ?? ENDOFCHAIN, true)
  header.setUint32(72, numDifatSectors, true)
  for (let i = 0; i < HEADER_DIFAT_ENTRIES; i++) {
    header.setUint32(76 + i * 4, headerDifat[i] ?? FREESECT, true)
  }

  for (let i = 0; i < sectors.length; i++) {
    out.set(sectors[i]!, (i + 1) * sectorSize)
  }
  return out
}

// ---------------------------------------------------------------------------

function writeDirEntry(
  bytes: Uint8Array,
  view: DataView,
  base: number,
  node: Node,
  majorVersion: number,
): void {
  if (node.name.length > 31) {
    throw new CfbError(`Directory entry name too long (max 31 chars): ${node.name}`)
  }
  for (let i = 0; i < node.name.length; i++) {
    view.setUint16(base + i * 2, node.name.charCodeAt(i), true)
  }
  view.setUint16(base + 64, (node.name.length + 1) * 2, true)
  view.setUint8(base + 66, node.type)
  view.setUint8(base + 67, node.color)
  view.setUint32(base + 68, node.left, true)
  view.setUint32(base + 72, node.right, true)
  view.setUint32(base + 76, node.child, true)
  // 클래스 id는 저장소를 소유한 애플리케이션을 식별한다. HWP는 0으로 둔다.
  // 오피스 문서는 루트 항목 사본에 앱 GUID를 넣는다. 상태 비트(+96)와 두
  // FILETIME(+100, +108)은 0으로 둔다. 셋 다 선택 사항이다.
  if (node.clsid) bytes.set(node.clsid, base + 80)
  view.setUint32(base + 116, node.startSector, true)
  if (majorVersion === 3) {
    view.setUint32(base + 120, node.size, true)
    view.setUint32(base + 124, 0, true)
  } else {
    view.setBigUint64(base + 120, BigInt(node.size), true)
  }
}

function buildTree(input: CfbInput): Node {
  const root: Node = makeNode('Root Entry', '', ObjectType.RootStorage)
  if (input.rootClsid) {
    if (input.rootClsid.length !== 16) {
      throw new CfbError(`rootClsid must be 16 bytes, got ${input.rootClsid.length}`)
    }
    root.clsid = input.rootClsid
  }
  const storages = new Map<string, Node>([['', root]])

  const ensureStorage = (path: string): Node => {
    const existing = storages.get(path)
    if (existing) return existing
    const slash = path.lastIndexOf('/')
    const parentPath = slash === -1 ? '' : path.slice(0, slash)
    const name = slash === -1 ? path : path.slice(slash + 1)
    const parent = ensureStorage(parentPath)
    const node = makeNode(name, path, ObjectType.Storage)
    parent.children.push(node)
    storages.set(path, node)
    return node
  }

  for (const path of input.storages ?? []) {
    if (path) ensureStorage(path)
  }

  for (const [path, content] of Object.entries(input.streams)) {
    if (!path) throw new CfbError('Stream path may not be empty')
    const slash = path.lastIndexOf('/')
    const parentPath = slash === -1 ? '' : path.slice(0, slash)
    const name = slash === -1 ? path : path.slice(slash + 1)
    const parent = ensureStorage(parentPath)
    const node = makeNode(name, path, ObjectType.Stream)
    node.content = content
    parent.children.push(node)
  }

  return root
}

function makeNode(name: string, path: string, type: ObjectType): Node {
  return {
    name,
    path,
    type,
    content: new Uint8Array(0),
    children: [],
    id: -1,
    left: NOSTREAM,
    right: NOSTREAM,
    child: NOSTREAM,
    color: ColorFlag.Black,
    startSector: ENDOFCHAIN,
    size: 0,
  }
}

/** 트리를 잇기 전에 id를 배정하도록 깊이 우선으로 모은다. */
function collect(node: Node, out: Node[]): void {
  node.id = out.length
  out.push(node)
  node.children.sort((a, b) => compareEntryNames(a.name, b.name))
  for (const child of node.children) collect(child, out)
}

function assignIds(root: Node, nodes: Node[]): void {
  void nodes
  const link = (node: Node): void => {
    if (node.children.length > 0) {
      node.child = buildRedBlack(node.children)
    }
    for (const child of node.children) link(child)
  }
  link(root)
}

/**
 * 이미 정렬된 형제 목록 위에 균형 잡힌 레드-블랙 트리를 만들고 그 루트의
 * id를 반환한다.
 *
 * 중간점에서 나누는 구성이라 모든 잎이 깊이 `d`나 `d-1`에 놓인다. 그다음 가장
 * 깊은 층만 적색으로 칠하면 레드-블랙 불변식(같은 흑색 높이, 적색 부모를 갖는
 * 적색 노드 없음)을 만족한다.
 */
function buildRedBlack(sorted: Node[]): number {
  let maxDepth = 0
  const build = (lo: number, hi: number, depth: number): number => {
    if (lo > hi) return NOSTREAM
    const mid = (lo + hi) >> 1
    const node = sorted[mid]!
    maxDepth = Math.max(maxDepth, depth)
    node.left = build(lo, mid - 1, depth + 1)
    node.right = build(mid + 1, hi, depth + 1)
    ;(node as Node & { depth: number }).depth = depth
    return node.id
  }
  const rootId = build(0, sorted.length - 1, 0)
  for (const node of sorted) {
    const depth = (node as Node & { depth?: number }).depth ?? 0
    node.color = depth === maxDepth && maxDepth > 0 ? ColorFlag.Red : ColorFlag.Black
  }
  return rootId
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
