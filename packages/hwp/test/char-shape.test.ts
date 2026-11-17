import { createDocument, defaultCharShape, parseColor } from '@js-hwp/core'
import { describe, expect, it } from 'vitest'
import { parseDocInfo, serializeDocInfo } from '../src/docinfo.js'
import { parseRecords, serializeRecords } from '../src/record.js'
import { DocInfoTag } from '../src/tags.js'

// 속성 워드는 글자 모양 레코드의 46번째 바이트에 있다.
const PROPERTIES = 46

function payloadWith(properties: number): Uint8Array {
  const doc = createDocument({ charShapes: [defaultCharShape()] })
  const payload = parseRecords(serializeDocInfo(doc)).find(r => r.tagId === DocInfoTag.CharShape)!.payload.slice()
  new DataView(payload.buffer).setUint32(PROPERTIES, properties >>> 0, true)
  return payload
}

function parseShape(properties: number) {
  const doc = createDocument({ charShapes: [] })
  parseDocInfo(doc, serializeRecords([{ tagId: DocInfoTag.CharShape, level: 1, payload: payloadWith(properties) }]))
  return doc.charShapes[0]!
}

function writtenProperties(shape: ReturnType<typeof parseShape>): number {
  const doc = createDocument({ charShapes: [shape] })
  const payload = parseRecords(serializeDocInfo(doc)).find(r => r.tagId === DocInfoTag.CharShape)!.payload
  return new DataView(payload.buffer, payload.byteOffset).getUint32(PROPERTIES, true)
}

const strike = (kind: number, style: number) => ((kind << 18) | (style << 26)) >>> 0

describe('글자 모양의 취소선', () => {
  it.each([
    [1, 0],
    [1, 1],
    [1, 15],
    [2, 0],
  ])('비트 18-20이 %i이고 선 모양이 %i이면 취소선이다', (kind, style) => {
    expect(parseShape(strike(kind, style)).strikeout).toMatchObject({ enabled: true, style })
  })

  it('비트 18-20이 0이면 선 모양과 관계없이 취소선이 없다', () => {
    expect(parseShape(strike(0, 1)).strikeout).toMatchObject({ enabled: false, style: 1 })
    expect(parseShape(strike(0, 15)).strikeout).toMatchObject({ enabled: false, style: 15 })
  })

  it.each([
    [1, 0, 1],
    [1, 15, 1],
    [2, 0, 1],
  ])('비트 18-20(%i)과 선 모양(%i)을 쓴다. 켜진 값은 %i이 된다', (kind, style, written) => {
    const properties = writtenProperties(parseShape(strike(kind, style)))
    expect((properties >>> 18) & 7).toBe(written)
    expect((properties >>> 26) & 15).toBe(style)
  })

  it('취소선이 없으면 두 필드를 0으로 쓴다', () => {
    const properties = writtenProperties(parseShape(0))
    expect((properties >>> 18) & 7).toBe(0)
    expect((properties >>> 26) & 15).toBe(0)
  })

  it('밑줄과 취소선을 함께 읽는다', () => {
    const shape = parseShape((strike(1, 0) | (3 << 2)) >>> 0)
    expect(shape.underline.kind).toBe(3)
    expect(shape.strikeout.enabled).toBe(true)
  })

  it('취소선 색을 보존한다', () => {
    const shape = parseShape(strike(1, 0))
    shape.strikeout.color = parseColor(0x112233)
    const doc = createDocument({ charShapes: [shape] })
    const back = createDocument({ charShapes: [] })
    parseDocInfo(back, serializeDocInfo(doc))
    expect(back.charShapes[0]!.strikeout.color).toEqual(parseColor(0x112233))
  })
})

describe('글자 모양의 강조점', () => {
  it.each([0, 1, 6, 7, 12, 15])('비트 21-24의 값 %i을 그대로 읽고 쓴다', (value) => {
    const shape = parseShape((value << 21) >>> 0)
    expect(shape.emphasis).toBe(value)
    expect((writtenProperties(shape) >>> 21) & 15).toBe(value)
  })
})

describe('꺼진 값 보존', () => {
  it('꺼진 밑줄·취소선·그림자의 필드를 레코드 그대로 쓴다', () => {
    const payload = payloadWith((5 << 4) >>> 0)
    payload.set([10, 20], 50) // 그림자 간격
    payload.set([1, 2, 3, 0], 56) // 밑줄 색
    payload.set([4, 5, 6, 0xff], 64) // 그림자 색
    payload.set([7, 8, 9, 0xc0], 70) // 취소선 색
    const doc = createDocument({ charShapes: [] })
    parseDocInfo(doc, serializeRecords([{ tagId: DocInfoTag.CharShape, level: 1, payload }]))
    const out = parseRecords(serializeDocInfo(doc)).find(r => r.tagId === DocInfoTag.CharShape)!.payload
    expect([...out]).toEqual([...payload])
  })

  it('새 문서의 글자 모양은 전부 꺼져 있다', () => {
    const doc = createDocument()
    const shape = doc.charShapes[0]!
    expect(shape.underline.kind).toBe(0)
    expect(shape.strikeout.enabled).toBe(false)
    expect(shape.shadow.kind).toBe(0)
  })
})
