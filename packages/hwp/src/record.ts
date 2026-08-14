/**
 * HWP 레코드 스트림.
 *
 * `DocInfo`와 각 `BodyText/Section{N}`은 레코드의 연속이다. 레코드는 4바이트
 * 리틀 엔디언 헤더에 페이로드가 이어진 것이다.
 *
 * ```text
 *   bits  0..9   tag id      (0..1023) — 레코드 종류
 *   bits 10..19  level       (0..1023) — 중첩 깊이
 *   bits 20..31  size        (0..4095) — 페이로드 길이(바이트)
 * ```
 *
 * 크기 필드가 `0xFFF`로 읽히면 진짜 길이는 다음 DWORD다. 그래서 4095바이트
 * 페이로드도 이스케이프를 써야 한다. 레벨이 평평한 열을 트리로 만든다.
 * 레벨 N+1 레코드는 가장 최근 레벨 N 레코드의 자식이다.
 */

import { ByteWriter, HwpFormatError } from './bytes.js'

/** 0xFFF 이스케이프 임계값. 이 이상인 페이로드는 긴 형식이 필요하다. */
const SIZE_ESCAPE = 0xfff

export interface HwpRecord {
  tagId: number
  level: number
  payload: Uint8Array
}

/** 레코드와 그 자식. {@link buildRecordTree}가 만든다. */
export interface RecordNode extends HwpRecord {
  children: RecordNode[]
  parent?: RecordNode
}

/** 레코드 스트림을 평평한 레코드 목록으로 나눈다. */
export function parseRecords(data: Uint8Array): HwpRecord[] {
  const records: HwpRecord[] = []
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 0

  while (offset + 4 <= data.length) {
    const header = view.getUint32(offset, true)
    offset += 4

    const tagId = header & 0x3ff
    const level = (header >>> 10) & 0x3ff
    let size = (header >>> 20) & 0xfff

    if (size === SIZE_ESCAPE) {
      if (offset + 4 > data.length) {
        throw new HwpFormatError('Record claims an extended size but the stream ends')
      }
      size = view.getUint32(offset, true)
      offset += 4
    }

    if (offset + size > data.length) {
      // 잘린 마지막 레코드. 실제 파일에 가끔 엉터리 헤더로 디코드되는 후행
      // 패딩이 있다. 문서 전체를 실패시키는 대신 건질 수 있는 걸 건진다.

      const available = data.length - offset
      if (available <= 0) break
      records.push({ tagId, level, payload: data.subarray(offset, data.length) })
      break
    }

    records.push({ tagId, level, payload: data.subarray(offset, offset + size) })
    offset += size
  }

  return records
}

/** 레코드를 다시 스트림으로 직렬화한다. */
export function serializeRecords(records: HwpRecord[]): Uint8Array {
  const writer = new ByteWriter()
  for (const record of records) {
    if (record.tagId > 0x3ff) throw new HwpFormatError(`Tag id ${record.tagId} exceeds 10 bits`)
    if (record.level > 0x3ff) throw new HwpFormatError(`Level ${record.level} exceeds 10 bits`)

    const size = record.payload.length
    const long = size >= SIZE_ESCAPE
    const header =
      ((record.tagId & 0x3ff) |
        ((record.level & 0x3ff) << 10) |
        (((long ? SIZE_ESCAPE : size) & 0xfff) << 20)) >>>
      0

    writer.uint32(header)
    if (long) writer.uint32(size)
    writer.bytes(record.payload)
  }
  return writer.finish()
}

/**
 * 레벨 필드를 써서 평평한 레코드 목록을 트리로 만든다.
 *
 * 스트림의 최소 레벨에 있는 레코드가 루트가 된다. 앞의 것보다 깊은 레코드는
 * 거기에 붙고, 같거나 얕은 레코드는 스택을 거슬러 올라간다.
 *
 */
export function buildRecordTree(records: HwpRecord[]): RecordNode[] {
  const roots: RecordNode[] = []
  const stack: RecordNode[] = []

  for (const record of records) {
    const node: RecordNode = { ...record, children: [] }

    while (stack.length > 0 && stack[stack.length - 1]!.level >= node.level) {
      stack.pop()
    }

    const parent = stack[stack.length - 1]
    if (parent) {
      node.parent = parent
      parent.children.push(node)
    } else {
      roots.push(node)
    }
    stack.push(node)
  }

  return roots
}

/** 레코드 트리를 문서 순서대로 다시 목록으로 평탄화한다. */
export function flattenRecordTree(nodes: RecordNode[]): HwpRecord[] {
  const out: HwpRecord[] = []
  const visit = (node: RecordNode): void => {
    out.push({ tagId: node.tagId, level: node.level, payload: node.payload })
    for (const child of node.children) visit(child)
  }
  for (const node of nodes) visit(node)
  return out
}

/**
 * 중첩을 추적하면서 레코드를 모은다. 라이터가 모든 함수에 레벨을 넘기지 않고도
 * 트리를 내보낼 수 있게 한다.
 */
export class RecordWriter {
  readonly #records: HwpRecord[] = []
  #level = 0

  get level(): number {
    return this.#level
  }

  /** 현재 레벨에 레코드를 내보낸다. */
  write(tagId: number, payload: Uint8Array | ByteWriter): this {
    this.#records.push({
      tagId,
      level: this.#level,
      payload: payload instanceof ByteWriter ? payload.finish() : payload,
    })
    return this
  }

  /** 레코드를 내보내고 그 자식을 한 레벨 깊게 중첩한다. */
  nested(tagId: number, payload: Uint8Array | ByteWriter, build: () => void): this {
    this.write(tagId, payload)
    this.#level++
    try {
      build()
    } finally {
      this.#level--
    }
    return this
  }

  /** 레코드를 먼저 내보내지 않고 `build`를 한 레벨 깊게 실행한다. */
  descend(build: () => void): this {
    this.#level++
    try {
      build()
    } finally {
      this.#level--
    }
    return this
  }

  get records(): readonly HwpRecord[] {
    return this.#records
  }

  finish(): Uint8Array {
    return serializeRecords(this.#records)
  }
}

/** 주어진 태그를 가진 첫 자식을 찾는다. */
export function childWithTag(node: RecordNode, tagId: number): RecordNode | undefined {
  return node.children.find((child) => child.tagId === tagId)
}

/** 주어진 태그를 가진 모든 자식. */
export function childrenWithTag(node: RecordNode, tagId: number): RecordNode[] {
  return node.children.filter((child) => child.tagId === tagId)
}
