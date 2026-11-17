import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDocument, StyleKind, type HwpDocument } from '@js-hwp/core'
import CFB from 'cfb'
import { describe, expect, it } from 'vitest'
import { parseDocInfo, serializeDocInfo } from '../src/docinfo.js'
import { parseHwp, serializeHwp } from '../src/document.js'
import { maybeInflate } from '../src/compress.js'
import { parseRecords, serializeRecords, type HwpRecord } from '../src/record.js'
import { DocInfoTag } from '../src/tags.js'

// 원본 비트 보존 원칙: 한글이 저장한 파일을 읽고 그대로 쓰면 바이트가 같아야 한다.
// 코덱이 보존을 구현한 레코드만 확인한다.
const PRESERVED = [
  DocInfoTag.DocumentProperties, DocInfoTag.FaceName, DocInfoTag.CharShape, DocInfoTag.TabDef,
  DocInfoTag.Bullet, DocInfoTag.ParaShape, DocInfoTag.Style,
]

const root = join(__dirname, '../../..')
const corpus = [
  ...readdirSync(join(root, 'docs/experiments'), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.hwp'))
    .map((f) => join(root, 'docs/experiments', f)),
  join(root, 'fixtures/hwp/fill.hwp'),
]

function streams(bytes: Uint8Array) {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = new Uint8Array(CFB.find(c, 'FileHeader')!.content as Uint8Array)
  const docInfo = new Uint8Array(CFB.find(c, 'DocInfo')!.content as Uint8Array)
  return { header, records: parseRecords(maybeInflate(docInfo, (header[36]! & 1) === 1)) }
}

const pick = (records: HwpRecord[], tag: number) =>
  records.filter((r) => r.tagId === tag).map((r) => [r.level, [...r.payload]])

describe('저장소 HWP 파일의 왕복', () => {
  it.each(corpus.map((f) => [f.slice(root.length + 1), f]))('%s', (_, file) => {
    const original = new Uint8Array(readFileSync(file))
    const before = streams(original)
    const after = streams(serializeHwp(parseHwp(original)))
    for (const tag of PRESERVED) {
      expect(pick(after.records, tag), `tag ${tag}`).toEqual(pick(before.records, tag))
    }
  })
})

// --- 저장소 파일에 없는 경우 -------------------------------------------------

function emptyDocument(): HwpDocument {
  return createDocument({
    fonts: [], charShapes: [], paraShapes: [], borderFills: [], styles: [],
    numberings: [], bullets: [], tabDefs: [], binData: [], sections: [],
  })
}

function roundTrip(records: HwpRecord[]) {
  const doc = emptyDocument()
  parseDocInfo(doc, serializeRecords(records))
  return { doc, records: parseRecords(serializeDocInfo(doc)) }
}

const int32s = (...values: number[]) => {
  const out = new Uint8Array(values.length * 4)
  values.forEach((v, i) => new DataView(out.buffer).setInt32(i * 4, v, true))
  return out
}

function faceName(attr: number, name: string): Uint8Array {
  const out = new Uint8Array(3 + name.length * 2)
  out[0] = attr
  new DataView(out.buffer).setUint16(1, name.length, true)
  for (let i = 0; i < name.length; i++) new DataView(out.buffer).setUint16(3 + i * 2, name.charCodeAt(i), true)
  return out
}

/** 글꼴 id만 채운 74B 글자 모양. */
function charShape(fontIds: number[]): Uint8Array {
  const out = new Uint8Array(74)
  fontIds.forEach((id, i) => new DataView(out.buffer).setUint16(i * 2, id, true))
  return out
}

const rec = (tagId: number, payload: Uint8Array, level = 1): HwpRecord => ({ tagId, level, payload })

describe('글꼴: 문자 체계별 목록', () => {
  // 한글 목록은 [가, 나], 영어 목록은 [나], 나머지 다섯 문자 체계는 [가].
  // 글자 모양은 한글 1번(나), 영어 0번(나), 나머지 0번(가)을 쓴다.
  const records = [
    rec(DocInfoTag.IdMappings, int32s(0, 2, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0), 0),
    rec(DocInfoTag.FaceName, faceName(0x01, '가')),
    rec(DocInfoTag.FaceName, faceName(0x02, '나')),
    rec(DocInfoTag.FaceName, faceName(0x02, '나')),
    ...Array.from({ length: 5 }, () => rec(DocInfoTag.FaceName, faceName(0x01, '가'))),
    rec(DocInfoTag.CharShape, charShape([1, 0, 0, 0, 0, 0, 0])),
  ]

  it('문자 체계별 목록을 나눠 두고 글꼴 id는 그 목록의 번호로 둔다', () => {
    const { doc } = roundTrip(records)
    expect(doc.fonts.map((fonts) => fonts.map((f) => f.name))).toEqual([
      ['가', '나'], ['나'], ['가'], ['가'], ['가'], ['가'], ['가'],
    ])
    expect(doc.charShapes[0]!.fontIds).toEqual([1, 0, 0, 0, 0, 0, 0])
  })

  it('문자 체계별 목록과 글꼴 속성 하위 비트를 그대로 쓴다', () => {
    const out = roundTrip(records).records
    for (const tag of [DocInfoTag.IdMappings, DocInfoTag.FaceName, DocInfoTag.CharShape])
      expect(pick(out, tag), `tag ${tag}`).toEqual(pick(records, tag))
  })
})

describe('모르는 비트와 남는 바이트', () => {
  // 이름 "가" 하나, 영문 이름 없음, 속성, 다음 스타일 0, 언어 1042, 문단·글자 모양 0, 끝 2B.
  const style = (properties: number) => Uint8Array.from([1, 0, 0xac00 & 0xff, 0xac00 >> 8, 0, 0, properties, 0, 0x12, 0x04, 0, 0, 0, 0, 0, 0])

  it('스타일: 모르는 종류 값(kogl 파일의 4)과 bit 3~7을 보존한다', () => {
    for (const properties of [0x04, 0x09, 0xf0]) {
      const records = [rec(DocInfoTag.Style, style(properties))]
      expect(pick(roundTrip(records).records, DocInfoTag.Style)).toEqual(pick(records, DocInfoTag.Style))
    }
  })

  it('스타일: 글자 모양 아이디 뒤의 바이트를 길이째 보존한다(정오표 정정 49)', () => {
    const base = style(0)
    for (const payload of [Uint8Array.from([...base.slice(0, 14), 0x34, 0x12]), base.slice(0, 14), Uint8Array.from([...base, 0xee])]) {
      const records = [rec(DocInfoTag.Style, payload)]
      expect(pick(roundTrip(records).records, DocInfoTag.Style)).toEqual(pick(records, DocInfoTag.Style))
    }
    const { doc } = roundTrip([rec(DocInfoTag.Style, base)])
    delete doc.styles[0]!.trailing
    expect(pick(parseRecords(serializeDocInfo(doc)), DocInfoTag.Style)).toEqual([[1, [...base]]])
  })

  it('스타일: 모르는 종류 값을 글자 스타일로 바꾸면 거부한다', () => {
    const { doc } = roundTrip([rec(DocInfoTag.Style, style(0x04))])
    doc.styles[0]!.kind = StyleKind.Char
    expect(() => serializeDocInfo(doc)).toThrow(RangeError)
  })
})

/** 속성 1과 끝 문단 수준만 채운 58B 문단 모양. */
function paraShape(properties1: number, level: number): Uint8Array {
  const out = new Uint8Array(58)
  const view = new DataView(out.buffer)
  view.setUint32(0, properties1, true)
  view.setUint32(54, level, true)
  return out
}

describe('문단 모양: 문단 수준 (정오표 정정 41, 42)', () => {
  // 개요(bit 23~24 = 1), 9수준: bit 25~27은 6에 머물고 끝 필드가 8이다.
  const records = [rec(DocInfoTag.ParaShape, paraShape((1 << 23) | (6 << 25), 8))]

  it('수준을 끝 필드에서 읽고 바이트 그대로 쓴다', () => {
    const { doc, records: out } = roundTrip(records)
    expect(doc.paraShapes[0]!.headingLevel).toBe(8)
    expect(pick(out, DocInfoTag.ParaShape)).toEqual(pick(records, DocInfoTag.ParaShape))
  })

  it('수준을 바꾸면 bit 25~27과 끝 필드를 함께 쓴다', () => {
    const doc = emptyDocument()
    parseDocInfo(doc, serializeRecords(records))
    doc.paraShapes[0]!.headingLevel = 3
    const out = pick(parseRecords(serializeDocInfo(doc)), DocInfoTag.ParaShape)
    expect(out).toEqual(pick([rec(DocInfoTag.ParaShape, paraShape((1 << 23) | (3 << 25), 3))], DocInfoTag.ParaShape))
  })

  it('54B 레코드를 8수준 이상으로 바꾸면 58B로 올려 쓴다', () => {
    const doc = emptyDocument()
    parseDocInfo(doc, serializeRecords([rec(DocInfoTag.ParaShape, paraShape(1 << 23, 0).subarray(0, 54))]))
    doc.paraShapes[0]!.headingLevel = 7
    const out = parseRecords(serializeDocInfo(doc)).find((r) => r.tagId === DocInfoTag.ParaShape)!.payload
    expect(out.length).toBe(58)
    expect(new DataView(out.buffer, out.byteOffset).getUint32(54, true)).toBe(7)
  })
})

/** 줄 간격 두 칸만 채운 58B 문단 모양. */
function lineSpacing(oldKind: number, oldValue: number, kind: number, value: number): Uint8Array {
  const out = new Uint8Array(58)
  const view = new DataView(out.buffer)
  view.setUint32(0, oldKind, true)
  view.setInt32(24, oldValue, true)
  view.setUint32(46, kind, true)
  view.setUint32(50, value, true)
  return out
}

describe('문단 모양: 옛 줄 간격 칸 (정오표 정정 44)', () => {
  it('최소는 옛 칸에 글자에 따라 100%를 쓴 그대로 왕복한다', () => {
    const records = [rec(DocInfoTag.ParaShape, lineSpacing(0, 100, 3, 3200))]
    expect(pick(roundTrip(records).records, DocInfoTag.ParaShape)).toEqual(pick(records, DocInfoTag.ParaShape))
  })

  it('종류를 바꾸면 옛 칸을 한글처럼 다시 쓴다', () => {
    const doc = emptyDocument()
    parseDocInfo(doc, serializeRecords([rec(DocInfoTag.ParaShape, lineSpacing(0, 100, 3, 3200))]))
    doc.paraShapes[0]!.lineSpacing = { kind: 1, value: 3200 }
    const out = pick(parseRecords(serializeDocInfo(doc)), DocInfoTag.ParaShape)
    expect(out).toEqual(pick([rec(DocInfoTag.ParaShape, lineSpacing(1, 3200, 1, 3200))], DocInfoTag.ParaShape))
  })
})
