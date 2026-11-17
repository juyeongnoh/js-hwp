import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDocument, DocumentBuilder, type ParaShape } from '@js-hwp/core'
import CFB from 'cfb'
import { describe, expect, it } from 'vitest'
import { maybeInflate } from '../src/compress.js'
import { parseDocInfo, serializeDocInfo } from '../src/docinfo.js'
import { parseHwp, serializeHwp } from '../src/document.js'
import { parseRecords, serializeRecords } from '../src/record.js'
import { DocInfoTag } from '../src/tags.js'

const root = join(__dirname, '../../..')
const files = ['docs/experiments', 'fixtures', 'scratch'].flatMap((d) =>
  readdirSync(join(root, d), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.hwp'))
    .map((f) => join(root, d, f)),
)

function paraShapeRecords(bytes: Uint8Array) {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const docInfo = new Uint8Array(CFB.find(c, 'DocInfo')!.content as Uint8Array)
  const version = new DataView(new Uint8Array(header).buffer).getUint32(32, true)
  const records = parseRecords(maybeInflate(docInfo, (header[36]! & 1) === 1))
    .filter((r) => r.tagId === DocInfoTag.ParaShape)
    .map((r) => [r.level, [...r.payload]] as [number, number[]])
  return { version, records }
}

/**
 * 한글이 이 레코드를 저장하면 나올 값. 한글은 두 줄 간격 칸이 다르면 자기가 읽은 칸(정오표 E20)의
 * 값으로 두 칸을 짝 맞춰 저장한다. 한글이 하는 레코드 길이·파일 버전 변경은 따르지 않는다.
 */
function asHangulSaves(payload: number[], version: number): number[] {
  if (payload.length < 54) return payload
  const out = new Uint8Array(payload)
  const v = new DataView(out.buffer)
  const p1 = v.getUint32(0, true)
  const newKind = v.getUint32(46, true) & 0x1f
  const useOld = newKind === 0 && version < 0x05010100
  const kind = useOld ? p1 & 3 : newKind
  const value = useOld ? v.getInt32(24, true) : v.getUint32(50, true)
  const atLeast = kind === 3
  v.setUint32(0, ((p1 & ~3) | (atLeast ? 0 : kind)) >>> 0, true)
  v.setInt32(24, atLeast ? 100 : value, true)
  v.setUint32(46, ((v.getUint32(46, true) & ~0x1f) | kind) >>> 0, true)
  v.setUint32(50, value, true)
  return [...out]
}

describe('저장소 HWP 파일의 문단 모양 왕복', () => {
  // 기대값은 원본이 아니라 한글이 저장한 결과다. 한글이 만든 파일에서는 둘이 같다.
  it.each(files.map((f) => [f.slice(root.length + 1), f]))('%s', (_, file) => {
    const original = paraShapeRecords(new Uint8Array(readFileSync(file)))
    const written = paraShapeRecords(serializeHwp(parseHwp(new Uint8Array(readFileSync(file)))))
    expect(written.records).toEqual(original.records.map(([level, p]) => [level, asHangulSaves(p, original.version)]))
  })
})

function parse(payload: Uint8Array): ParaShape {
  const doc = createDocument()
  parseDocInfo(doc, serializeRecords([{ tagId: DocInfoTag.ParaShape, level: 1, payload }]))
  return doc.paraShapes.at(-1)!
}

function write(shape: ParaShape): number[] {
  const doc = createDocument({ paraShapes: [shape] })
  return [...parseRecords(serializeDocInfo(doc)).filter((r) => r.tagId === DocInfoTag.ParaShape).at(-1)!.payload]
}

/** 비트와 오프셋을 직접 채운 문단 모양 레코드. */
function record(length: number, fill: (v: DataView) => void): Uint8Array {
  const out = new Uint8Array(length)
  fill(new DataView(out.buffer))
  return out
}

describe('문단 모양 레코드', () => {
  it('46B(5.0.2.5) 레코드는 속성 1 bit 0-1의 줄 간격 종류를 읽고 46B로 쓴다', () => {
    const payload = record(46, (v) => { v.setUint32(0, 0x2, true); v.setInt32(24, 300, true) })
    const shape = parse(payload)
    expect(shape.recordLayout).toBe(46)
    expect(shape.lineSpacing).toEqual({ kind: 2, value: 300 })
    expect(write(shape)).toEqual([...payload])
  })

  it('46B 레코드를 최소로 바꾸면 그 레코드만 58B로 올려 쓴다', () => {
    const shape = parse(record(46, (v) => { v.setUint32(0, (2 << 2) | (3 << 25), true); v.setInt32(24, 160, true) }))
    const out = write({ ...shape, lineSpacing: { kind: 3, value: 3200 } })
    const v = new DataView(new Uint8Array(out).buffer)
    expect(out.length).toBe(58)
    expect(v.getUint32(0, true) & 3).toBe(0) // 옛 칸 글자에 따라
    expect((v.getUint32(0, true) >>> 2) & 7).toBe(2) // 정렬 유지
    expect(v.getInt32(24, true)).toBe(100)
    expect(v.getUint32(46, true) & 0x1f).toBe(3)
    expect(v.getUint32(50, true)).toBe(3200)
    expect(v.getUint32(54, true)).toBe(3) // 문단 수준
    expect(parse(new Uint8Array(out)).lineSpacing).toEqual({ kind: 3, value: 3200 })
  })

  it('46·54B 레코드를 8~10수준으로 바꾸면 그 레코드만 58B로 올려 쓴다', () => {
    for (const length of [46, 54]) {
      const shape = parse(record(length, (v) => { v.setUint32(0, 2 << 23, true); v.setInt32(24, 160, true); if (length === 54) v.setUint32(50, 160, true) }))
      const out = write({ ...shape, headingLevel: 8 })
      const v = new DataView(new Uint8Array(out).buffer)
      expect(out.length).toBe(58)
      expect((v.getUint32(0, true) >>> 25) & 7).toBe(6)
      expect(v.getUint32(46, true) & 0x1f).toBe(0)
      expect(v.getUint32(50, true)).toBe(160)
      expect(v.getUint32(54, true)).toBe(8)
      expect(write({ ...shape, headingLevel: 6 }).length).toBe(length)
    }
  })

  it('54B 레코드는 54B로 쓴다', () => {
    const payload = record(54, (v) => { v.setInt32(24, 160, true); v.setUint32(50, 160, true) })
    expect(write(parse(payload))).toEqual([...payload])
  })

  it('속성 1·2·3의 모르는 비트와 문단 수준 뒤 바이트를 보존한다', () => {
    const payload = record(60, (v) => {
      v.setUint32(0, 0xc0000000, true) // bit 30-31. bit 0-1은 줄 간격에서 정한다(정정 44)
      v.setUint32(42, 0x8, true) // 속성 2 bit 3
      v.setUint32(46, 0x80000000, true)
      v.setUint16(58, 0xbeef, true)
    })
    const shape = parse(payload)
    expect(shape.unknownBits1).toBe(0xc0000000)
    expect(shape.unknownBits2).toBe(0x8)
    expect(shape.unknownBits3).toBe(0x80000000)
    expect(write(shape)).toEqual([...payload])
  })

  it('공백 최소값은 bit 9-15에 100에서 뺀 값으로 담긴다(정오표 E21)', () => {
    // 한글이 쓴 오프셋 1 바이트: 100% 01, 99% 03, 98% 05, 25% 97. bit 8은 줄 격자.
    for (const [byte, condense] of [[0x01, undefined], [0x03, 99], [0x05, 98], [0x97, 25]] as const) {
      const payload = record(58, (v) => { v.setUint8(1, byte); v.setInt32(24, 160, true); v.setUint32(50, 160, true) })
      const shape = parse(payload)
      expect(shape.condense).toBe(condense)
      expect(shape.unknownBits1).toBeUndefined()
      expect(write(shape)).toEqual([...payload])
    }
  })

  it('75를 넘는 공백 최소값 칸은 모르는 비트로 보존한다', () => {
    const payload = record(58, (v) => { v.setUint32(0, 76 << 9, true); v.setInt32(24, 160, true); v.setUint32(50, 160, true) })
    const shape = parse(payload)
    expect(shape.condense).toBeUndefined()
    expect(shape.unknownBits1).toBe(76 << 9)
    expect(write(shape)).toEqual([...payload])
  })

  it('공백 최소값을 고쳐 쓸 때 25~100 정수만 받는다', () => {
    const shape = parse(record(58, (v) => { v.setInt32(24, 160, true); v.setUint32(50, 160, true) }))
    expect(new DataView(new Uint8Array(write({ ...shape, condense: 80 })).buffer).getUint32(0, true) >>> 9 & 0x7f).toBe(20)
    for (const condense of [24, 101, 50.5]) expect(() => write({ ...shape, condense })).toThrow(RangeError)
  })

  it('한 줄로 입력 여부는 속성 2 bit 0-1을 읽어 boolean으로 둔다(정오표 정정 46)', () => {
    const payload = record(58, (v) => { v.setUint32(42, 0x1, true); v.setInt32(24, 160, true); v.setUint32(50, 160, true) })
    const shape = parse(payload)
    expect(shape.singleLine).toBe(true)
    expect(shape.unknownBits2).toBeUndefined()
    expect(write(shape)).toEqual([...payload])
    expect(write({ ...shape, singleLine: false })[42]).toBe(0)
  })

  it('한 줄로 입력 칸의 2·3은 모르는 비트로 보존한다', () => {
    const payload = record(58, (v) => { v.setUint32(42, 0x2, true); v.setInt32(24, 160, true); v.setUint32(50, 160, true) })
    const shape = parse(payload)
    expect(shape.singleLine).toBeUndefined()
    expect(shape.unknownBits2).toBe(0x2)
    expect(write(shape)).toEqual([...payload])
  })

  it('머리 종류가 없어도 머리 id·수준과 테두리 값을 보존한다', () => {
    const payload = record(58, (v) => {
      v.setUint32(0, (3 << 25) | (1 << 28), true) // 수준 3, 테두리 연결
      v.setUint16(30, 5, true)
      v.setUint32(54, 3, true)
      v.setInt16(34, 10, true)
    })
    expect(write(parse(payload))).toEqual([...payload])
  })

  it('번호·글머리표·테두리 참조는 파일에서 1부터, 모델에서 0부터 센다', () => {
    const payload = record(58, (v) => {
      v.setUint32(0, 3 << 23, true) // 글머리표
      v.setUint16(30, 1, true)
      v.setUint16(32, 2, true)
    })
    const shape = parse(payload)
    expect(shape.headingId).toBe(0)
    expect(shape.border?.borderFillId).toBe(1)
    expect(write(shape)).toEqual([...payload])
    expect(() => write({ ...shape, headingId: -1 })).toThrow(RangeError)
  })

  it('빌더의 첫 글머리표·번호 목록은 파일에 참조 1로 저장된다', () => {
    for (const kind of ['bullet', 'number'] as const) {
      const doc = new DocumentBuilder().list(['가'], { kind }).build()
      const shapes = parseRecords(serializeDocInfo(doc)).filter((r) => r.tagId === DocInfoTag.ParaShape)
      const ids = shapes.map((r) => new DataView(r.payload.buffer, r.payload.byteOffset).getUint16(30, true))
      expect(ids.filter((id) => id !== 0)).toEqual([1])
    }
  })

  it('참조 0은 참조 없음으로 읽고 0으로 쓴다', () => {
    const payload = record(58, (v) => { v.setInt16(34, 10, true) })
    const shape = parse(payload)
    expect(shape.headingId).toBeUndefined()
    expect(shape.border).toBeDefined()
    expect(shape.border?.borderFillId).toBeUndefined()
    expect(write(shape)).toEqual([...payload])
  })

  it('범위를 벗어난 값은 잘라 쓰지 않고 거부한다', () => {
    const shape = parse(record(58, (v) => { v.setInt32(24, 160, true); v.setUint32(50, 160, true) }))
    const bad: Partial<ParaShape>[] = [
      { align: 6 as never },
      { lineBreakLatin: 3 as never },
      { lineBreakHangul: 2 as never },
      { verticalAlign: 4 as never },
      { headingKind: 4 as never },
      { headingLevel: 10 },
      { lineSpacing: { kind: 4 as never, value: 160 } },
      { lineSpacing: { kind: 1, value: -1 } },
      { marginLeft: 2 ** 31 },
      { marginLeft: 1.5 },
      { tabDefId: 0x10000 },
      { border: { offsetLeft: 0x8000, offsetRight: 0, offsetTop: 0, offsetBottom: 0 } },
    ]
    for (const patch of bad) expect(() => write({ ...shape, ...patch }), JSON.stringify(patch)).toThrow(RangeError)
  })

  it('형식 정보가 없는 새 문단 모양은 한글 5.1 형식(58B)으로 쓴다', () => {
    const { recordLayout, trailing, ...fresh } = parse(record(54, () => {}))
    expect(write(fresh)).toHaveLength(58)
  })
})
