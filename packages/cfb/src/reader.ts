import {
  DIRECTORY_ENTRY_SIZE,
  ENDOFCHAIN,
  HEADER_DIFAT_ENTRIES,
  HEADER_SIZE,
  MAXREGSECT,
  MAXREGSID,
  NOSTREAM,
  ObjectType,
  SIGNATURE,
} from './constants.js'
import { foldName } from './names.js'
import type { CfbContainer, CfbEntry } from './types.js'

export class CfbError extends Error {
  override name = 'CfbError'
}

/** 디렉터리 순회의 스택 한계. {@link read} 참조. */
const MAX_TREE_DEPTH = 512

/** 트리를 경로로 순회하기 전의 원시 디렉터리 항목. */
interface RawDirEntry {
  name: string
  type: ObjectType
  leftSibling: number
  rightSibling: number
  child: number
  clsid: Uint8Array
  stateBits: number
  createdAt: bigint
  modifiedAt: bigint
  startSector: number
  size: number
}

/**
 * 복합 파일 바이너리(OLE2) 컨테이너를 파싱한다.
 *
 * 512바이트 섹터(메이저 버전 3)와 4096바이트 섹터(메이저 버전 4) 변종,
 * DIFAT 넘침 체인, 미니 스트림을 모두 처리한다.
 */
export function read(data: Uint8Array): CfbContainer {
  if (data.length < HEADER_SIZE) {
    throw new CfbError(`File too small to be a compound file (${data.length} bytes)`)
  }
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (data[i] !== SIGNATURE[i]) {
      throw new CfbError('Not a compound file: signature mismatch')
    }
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  const minorVersion = view.getUint16(24, true)
  const majorVersion = view.getUint16(26, true)
  const byteOrder = view.getUint16(28, true)
  if (byteOrder !== 0xfffe) {
    throw new CfbError(`Unsupported byte order marker 0x${byteOrder.toString(16)}`)
  }

  const sectorShift = view.getUint16(30, true)
  const miniSectorShift = view.getUint16(32, true)
  if (sectorShift !== 9 && sectorShift !== 12) {
    throw new CfbError(`Unsupported sector shift ${sectorShift}`)
  }
  const sectorSize = 1 << sectorShift
  const miniSectorSize = 1 << miniSectorShift

  // 오프셋 44는 numFatSectors다. 일부러 읽지 않는다. FAT은 DIFAT에서
  // 재구성하는데, FAT 섹터가 실제로 어디 있는지에 대한 권위가 DIFAT이고,
  // 개수를 믿는 건 과다 할당의 통로만 열어준다. 오프셋 40(numDirectorySectors)도
  // 마찬가지로 쓰지 않는다. 버전 3에서는 0이어야 하고, 길이는 디렉터리 체인이
  // 준다.
  const firstDirSector = view.getUint32(48, true)
  const miniStreamCutoff = view.getUint32(56, true)
  const firstMiniFatSector = view.getUint32(60, true)
  const numMiniFatSectors = view.getUint32(64, true)
  const firstDifatSector = view.getUint32(68, true)
  const numDifatSectors = view.getUint32(72, true)

  // MS-CFB §2.2: "섹터 번호는 다음 공식으로 파일 안의 바이트 오프셋으로 변환할
  // 수 있다: (섹터 번호 + 1) × 섹터 크기. 이는 파일의 섹터 #0이 0이 아니라
  // 바이트 오프셋 섹터 크기에서 시작한다는 뜻이다." 따라서 512바이트 헤더가
  // 첫 섹터 전체를 차지한다. 버전 4 파일에서는 그 뒤에 3584바이트 패딩이 오고
  // 섹터 0이 4096에서 시작한다. 여기에 512를 고정하면 — Pillow의 OLE 리더가
  // 저질렀고 olefile이 이름까지 대며 지적하는 실수 — 모든 버전 4 파일을
  // 3584바이트 어긋나게 읽는다.

  const sectorOffset = (sector: number): number => (sector + 1) * sectorSize
  const sectorCount = Math.max(0, Math.ceil((data.length - sectorSize) / sectorSize))

  const readSector = (sector: number): Uint8Array => {
    if (sector < 0 || sector >= sectorCount) {
      throw new CfbError(`Sector ${sector} out of range (file has ${sectorCount})`)
    }
    const start = sectorOffset(sector)
    return data.subarray(start, Math.min(start + sectorSize, data.length))
  }

  // ---- DIFAT ------------------------------------------------------------
  const difat: number[] = []
  for (let i = 0; i < HEADER_DIFAT_ENTRIES; i++) {
    const sector = view.getUint32(76 + i * 4, true)
    if (sector > MAXREGSECT) break
    difat.push(sector)
  }

  const entriesPerDifatSector = sectorSize / 4 - 1
  let difatSector = firstDifatSector
  // 순회를 섹터 수로 제한한다. 악의적 파일에서 numDifatSectors는 공격자가
  // 통제하고, 순환하는 체인은 안 그러면 2^32번까지 돌 수 있다.
  const difatSectorLimit = Math.min(numDifatSectors, sectorCount)
  for (let n = 0; n < difatSectorLimit && difatSector <= MAXREGSECT; n++) {
    const sec = readSector(difatSector)
    const secView = new DataView(sec.buffer, sec.byteOffset, sec.byteLength)
    for (let i = 0; i < entriesPerDifatSector; i++) {
      const s = secView.getUint32(i * 4, true)
      if (s > MAXREGSECT) continue
      difat.push(s)
    }
    difatSector = secView.getUint32(entriesPerDifatSector * 4, true)
  }

  // ---- FAT --------------------------------------------------------------
  // FAT 크기를 헤더의 numFatSectors가 아니라 DIFAT에서 잡는다. 꼬리를 0으로
  // 채우면 끝을 벗어난 체인이 종료되는 대신 섹터 0으로 걸어가게 되고,
  // numFatSectors는 손상된 파일에서 믿을 수 없다. 범위 밖 조회는 `undefined`를
  // 반환하고 아래에서 ENDOFCHAIN으로 읽힌다.

  const entriesPerFatSector = sectorSize / 4
  const fat = new Uint32Array(difat.length * entriesPerFatSector)
  let fatIndex = 0
  for (const sector of difat) {
    const sec = readSector(sector)
    const secView = new DataView(sec.buffer, sec.byteOffset, sec.byteLength)
    const available = Math.floor(sec.byteLength / 4)
    for (let i = 0; i < entriesPerFatSector; i++) {
      fat[fatIndex++] = i < available ? secView.getUint32(i * 4, true) : ENDOFCHAIN
    }
  }

  const followChain = (start: number, limit = fat.length + 1): number[] => {
    const chain: number[] = []
    const seen = new Set<number>()
    let sector = start
    while (sector <= MAXREGSECT && chain.length <= limit) {
      if (seen.has(sector)) throw new CfbError(`Cyclic sector chain at sector ${sector}`)
      seen.add(sector)
      chain.push(sector)
      sector = fat[sector] ?? ENDOFCHAIN
    }
    return chain
  }

  const readChain = (start: number, size?: number, what = 'a stream'): Uint8Array => {
    const chain = followChain(start)

    // 할당 전에 재본다. 디렉터리 항목의 크기 필드는 검증되지 않은 입력
    // 4바이트 또는 8바이트다. 2.5 KB 파일이 400 MB 스트림을 주장할 수 있고,
    // 먼저 할당하면 잘못된 문서가 전부 메모리 부족 중단이 된다. 체인은 범위
    // 안의 서로 다른 섹터를 담으므로 용량이 파일 자체로 제한된다.

    let capacity = 0
    for (const sector of chain) {
      if (sector < sectorCount) {
        capacity += Math.min(sectorSize, data.length - sectorOffset(sector))
      }
    }
    const total = size ?? capacity
    if (total > capacity) {
      throw new CfbError(
        `${what} declares ${total} bytes but its sector chain holds only ${capacity}`,
      )
    }

    const out = new Uint8Array(total)
    let written = 0
    for (const sector of chain) {
      if (written >= total) break
      const sec = readSector(sector)
      const take = Math.min(sectorSize, total - written, sec.byteLength)
      out.set(sec.subarray(0, take), written)
      written += take
    }
    return out
  }

  // ---- 디렉터리 ----------------------------------------------------------
  const dirBytes = readChain(firstDirSector, undefined, 'the directory')
  const dirCount = Math.floor(dirBytes.length / DIRECTORY_ENTRY_SIZE)
  const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength)
  const rawEntries: RawDirEntry[] = []

  for (let i = 0; i < dirCount; i++) {
    const base = i * DIRECTORY_ENTRY_SIZE
    const nameLength = dirView.getUint16(base + 64, true)
    const type = dirView.getUint8(base + 66) as ObjectType

    // nameLength는 종료 NUL을 포함한 바이트 수다.
    const chars = Math.max(0, Math.min(32, nameLength / 2) - 1)
    let name = ''
    for (let c = 0; c < chars; c++) {
      const code = dirView.getUint16(base + c * 2, true)
      if (code === 0) break
      name += String.fromCharCode(code)
    }

    rawEntries.push({
      name,
      type,
      leftSibling: dirView.getUint32(base + 68, true),
      rightSibling: dirView.getUint32(base + 72, true),
      child: dirView.getUint32(base + 76, true),
      clsid: dirBytes.subarray(base + 80, base + 96),
      stateBits: dirView.getUint32(base + 96, true),
      createdAt: dirView.getBigUint64(base + 100, true),
      modifiedAt: dirView.getBigUint64(base + 108, true),
      startSector: dirView.getUint32(base + 116, true),
      // 상위 dword는 v4에서만 의미가 있다. v3 파일은 거기에 쓰레기값을 남길 수
      // 있으므로 512바이트 섹터 파일에서는 마스크로 잘라낸다 (MS-CFB §2.6.1).
      size:
        majorVersion === 3
          ? dirView.getUint32(base + 120, true)
          : Number(dirView.getBigUint64(base + 120, true)),
    })
  }

  const root = rawEntries[0]
  if (!root) throw new CfbError('Compound file has no root directory entry')

  // ---- 미니 스트림 --------------------------------------------------------
  // numMiniFatSectors를 믿지 말고 체인을 따라 미니 FAT을 읽는다. 개수를 적게
  // 신고하면 미니 FAT이 조용히 잘리고, 그러면 모든 작은 스트림의 꼬리를 잃는다.
  // 지나치게 긴 체인의 뒤쪽 항목은 FREESECT이고 무해하다.

  const miniFatBytes =
    numMiniFatSectors > 0 && firstMiniFatSector <= MAXREGSECT
      ? readChain(firstMiniFatSector, undefined, 'the mini FAT')
      : new Uint8Array(0)
  const miniFat = new Uint32Array(
    miniFatBytes.buffer,
    miniFatBytes.byteOffset,
    Math.floor(miniFatBytes.byteLength / 4),
  )
  const miniStream =
    root.size > 0 ? readChain(root.startSector, root.size, 'the mini stream') : new Uint8Array(0)

  const readMiniChain = (start: number, size: number, what: string): Uint8Array => {
    // 미니 섹터는 서로 다르므로(아래 순환 가드가 강제한다) 어떤 미니 체인도
    // 미니 스트림 자체가 담은 것보다 많은 바이트를 낼 수 없다. 그걸 미리
    // 확인하면 엉터리 크기 필드가 할당을 몰아가지 못한다.
    if (size > miniStream.length) {
      throw new CfbError(
        `${what} declares ${size} bytes but the mini stream is only ${miniStream.length}`,
      )
    }
    const out = new Uint8Array(size)
    let written = 0
    let sector = start
    const seen = new Set<number>()
    while (sector <= MAXREGSECT && written < size) {
      if (seen.has(sector)) throw new CfbError(`Cyclic mini sector chain at ${sector}`)
      seen.add(sector)
      const start = sector * miniSectorSize
      const take = Math.min(miniSectorSize, size - written, miniStream.length - start)
      if (take <= 0) break
      out.set(miniStream.subarray(start, start + take), written)
      written += take
      sector = miniFat[sector] ?? ENDOFCHAIN
    }
    if (written < size) {
      throw new CfbError(`${what} declares ${size} bytes but its mini chain supplies ${written}`)
    }
    return out
  }

  const contentOf = (entry: RawDirEntry): Uint8Array => {
    if (entry.type !== ObjectType.Stream || entry.size === 0) return new Uint8Array(0)
    const what = `Stream "${entry.name}"`
    return entry.size < miniStreamCutoff
      ? readMiniChain(entry.startSector, entry.size, what)
      : readChain(entry.startSector, entry.size, what)
  }

  // ---- 레드-블랙 트리를 경로로 순회 ---------------------------------------
  const entries: CfbEntry[] = []
  const byPath = new Map<string, CfbEntry>()
  const visited = new Set<number>()

  const push = (raw: RawDirEntry, path: string): void => {
    const entry: CfbEntry = {
      name: raw.name,
      path,
      type: raw.type,
      content: contentOf(raw),
      clsid: raw.clsid,
      stateBits: raw.stateBits,
      createdAt: raw.createdAt,
      modifiedAt: raw.modifiedAt,
    }
    entries.push(entry)
    byPath.set(path, entry)
  }

  const walkSiblings = (id: number, parentPath: string, depth: number): void => {
    if (id > MAXREGSID || id === NOSTREAM) return
    if (visited.has(id)) return
    // 깊이는 스택에 기여하는 둘을 함께 센다. 형제 트리 하강과 저장소 중첩이다.
    // 제대로 된 형제 집합은 레드-블랙 트리라서 그 몫이 많아야 2·log2(n+1)이고
    // — 항목 10만 개짜리 디렉터리에서 약 34 — 실제 컨테이너는 저장소를 몇 단만
    // 중첩한다. 조작된 파일은 항목을 연결 리스트로 엮을 수 있다. 재귀에 경계를
    // 두면 그게 스택 오버플로가 아니라 타입 있는 오류가 된다.

    if (depth > MAX_TREE_DEPTH) {
      throw new CfbError(`Directory tree deeper than ${MAX_TREE_DEPTH} levels at entry ${id}`)
    }
    visited.add(id)
    const raw = rawEntries[id]
    if (!raw) return

    walkSiblings(raw.leftSibling, parentPath, depth + 1)

    const path = parentPath ? `${parentPath}/${raw.name}` : raw.name
    push(raw, path)
    if (raw.type === ObjectType.Storage || raw.type === ObjectType.RootStorage) {
      walkSiblings(raw.child, path, depth + 1)
    }

    walkSiblings(raw.rightSibling, parentPath, depth + 1)
  }

  push(root, '')
  visited.add(0)
  walkSiblings(root.child, '', 0)

  return {
    entries,
    byPath,
    majorVersion,
    minorVersion,
    rootClsid: root.clsid,
  }
}

/**
 * MS-CFB가 하는 대로 대소문자를 무시하고 이름을 대조해 경로로 항목을 찾는다.
 *
 * 이 포맷은 이름을 UTF-16LE로 저장하고 대문자로 접어서 비교하므로 `BinData`와
 * `Bindata`는 같은 이름이고 파일이 둘 중 아무거나 써도 합법이다. 서드파티
 * 도구가 쓴 HWP 파일에는 두 표기와 `PrvText` 대 `Prvtext`가 다 나타난다.
 * 정확 일치 `byPath` 조회는 그것들을 놓치고, 문서가 조용히 빈 것으로 읽힌다.
 *
 */
export function lookup(container: CfbContainer, path: string): CfbEntry | undefined {
  const exact = container.byPath.get(path)
  if (exact) return exact
  const folded = foldName(path)
  return container.entries.find((e) => foldName(e.path) === folded)
}

/** 경로로 스트림 하나를 읽는다. 없으면 `undefined`. */
export function readStream(container: CfbContainer, path: string): Uint8Array | undefined {
  const entry = lookup(container, path)
  return entry && entry.type === ObjectType.Stream ? entry.content : undefined
}

/** 저장소 경로의 직속 자식을 나열한다. */
export function listStorage(container: CfbContainer, path: string): CfbEntry[] {
  const self = foldName(path)
  const prefix = path ? `${self}/` : ''
  return container.entries.filter((e) => {
    const folded = foldName(e.path)
    return folded !== self && folded.startsWith(prefix) && !folded.slice(prefix.length).includes('/')
  })
}
