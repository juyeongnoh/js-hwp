import { createDocument, LineStyle, NO_COLOR, NO_FILL, parseColor } from '@js-hwp/core'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import CFB from 'cfb'
import { describe, expect, it } from 'vitest'
import { maybeInflate } from '../src/compress.js'
import { parseHwp, serializeHwp } from '../src/document.js'
import { parseDocInfo, serializeDocInfo } from '../src/docinfo.js'
import { parseRecords, serializeRecords } from '../src/record.js'
import { DocInfoTag } from '../src/tags.js'

// 기존 테두리 배치: 방향별 종류/굵기/색상 한 세트, 대각선, 채우기.
function payload(properties: number): Uint8Array {
  return new Uint8Array([
    properties & 0xff, properties >>> 8,
    1, 5, 0x11, 0x22, 0x33, 0,
    2, 6, 0x44, 0x55, 0x66, 0,
    3, 7, 0x77, 0x88, 0x99, 0,
    4, 8, 0xaa, 0xbb, 0xcc, 0,
    1, 9, 0x12, 0x34, 0x56, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
  ])
}

function parseBorder(properties: number) {
  const doc = createDocument()
  doc.borderFills = []
  parseDocInfo(doc, serializeRecords([{ tagId: DocInfoTag.BorderFill, level: 1, payload: payload(properties) }]))
  return doc.borderFills[0]!
}

function writeBorder(fill: ReturnType<typeof parseBorder>): Uint8Array {
  const doc = createDocument()
  doc.borderFills = [fill]
  return parseRecords(serializeDocInfo(doc)).find(r => r.tagId === DocInfoTag.BorderFill)!.payload
}

describe('테두리 배치와 표 24 속성', () => {
  it('각 방향을 종류·굵기·색상 한 세트로 읽고 쓴다', () => {
    const fill = parseBorder(0)
    expect([fill.left, fill.right, fill.top, fill.bottom]).toEqual([
      { style: 1, width: 5, color: parseColor(0x112233) },
      { style: 2, width: 6, color: parseColor(0x445566) },
      { style: 3, width: 7, color: parseColor(0x778899) },
      { style: 4, width: 8, color: parseColor(0xaabbcc) },
    ])
    expect(writeBorder(fill)).toEqual(payload(0))
  })

  it('대각선 바이트가 없으면 대각선을 파싱하지 않는다', () => {
    const doc = createDocument()
    doc.borderFills = []
    parseDocInfo(doc, serializeRecords([{
      tagId: DocInfoTag.BorderFill, level: 1, payload: payload(0x08).slice(0, 26),
    }]))
    expect(doc.borderFills[0]?.diagonal).toBeUndefined()
    expect(doc.borderFills[0]?.slashShape).toBe(2)
  })

  it('bit 4를 표 경계선 플래그로 해석하지 않는다', () => {
    expect(parseBorder(0x10).breakCellSeparateLine).toBeUndefined()
    const fill = parseBorder(0)
    fill.breakCellSeparateLine = true
    expect(writeBorder(fill)[0]! & 0x10).toBe(0)
  })

  it('대각선 모양·꺾은선·회전 및 중심선 비트를 보존한다', () => {
    // slash=110, backslash=011, 실측 BackSlash 꺾임(bit 9)과 명세 bit 10 등을 켬.
    const properties = 3 | (6 << 2) | (3 << 5) | (2 << 8) | (1 << 10) | (1 << 11) | (1 << 12) | (1 << 13)
    const fill = parseBorder(properties)
    expect(fill).toMatchObject({
      threeD: true, shadow: true, centerLine: true,
      slashShape: 6, backSlashShape: 3,
      slashCrooked: false, backSlashCrooked: true, backSlashCrookedSpec: true,
      slashRotated: true, backSlashRotated: true,
      diagonal: { style: LineStyle.Solid, width: 9, color: parseColor(0x123456) },
    })
    expect(writeBorder(fill)).toEqual(payload(properties))
  })

  it('루트의 모양과 대각선 선 정보를 독립적으로 기록한다', () => {
    const fill = parseBorder(0)
    fill.backSlashShape = 2
    fill.diagonal = { style: LineStyle.Solid, width: 0, color: parseColor(0) }
    fill.fill = NO_FILL
    const bytes = writeBorder(fill)
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint16(0, true)).toBe(2 << 5)
    expect([...bytes.slice(26, 32)]).toEqual([1, 0, 0, 0, 0, 0])
  })
})


describe('선 종류 저장값', () => {
  it.each([
    [LineStyle.None, 0], [LineStyle.Solid, 1], [LineStyle.Dashed, 2],
    [LineStyle.Dotted, 3], [LineStyle.DashDot, 4], [LineStyle.DashDotDot, 5],
    [LineStyle.LongDash, 6], [LineStyle.Circle, 7], [LineStyle.DoubleSlim, 8],
    [LineStyle.SlimThick, 9], [LineStyle.ThickSlim, 10], [LineStyle.SlimThickSlim, 11],
    [LineStyle.Wave, 12], [LineStyle.DoubleWave, 13], [LineStyle.Thick3D, 14],
    [LineStyle.ThickReverse3D, 15], [LineStyle.ThreeD, 16], [LineStyle.Reverse3D, 17],
  ])('선 종류 %s를 원시 값 %s로 기록하고 복원한다', (style, code) => {
    const fill = parseBorder(0)
    for (const line of [fill.left, fill.right, fill.top, fill.bottom]) line.style = style
    const bytes = writeBorder(fill)
    expect([2, 8, 14, 20].map(offset => bytes[offset])).toEqual(Array(4).fill(code))
    const doc = createDocument()
    doc.borderFills = []
    parseDocInfo(doc, serializeRecords([{ tagId: DocInfoTag.BorderFill, level: 1, payload: bytes }]))
    const back = doc.borderFills[0]!
    expect([back.left, back.right, back.top, back.bottom].map(line => line.style)).toEqual(Array(4).fill(style))
  })
})


describe('실측과 명세의 꺾임 비트 구분', () => {
  it.each([
    [0, false, false, false],
    [1, true, false, false],
    [2, false, true, false],
    [3, true, true, false],
    [4, false, false, true],
    [5, true, false, true],
    [6, false, true, true],
    [7, true, true, true],
  ] as const)('bit 8~10의 조합 %s를 서로 합치지 않고 읽고 쓴다', (code, slash, backSlash, spec) => {
    // 두 대각선 모양은 각각 010으로 고정한다. 꺾임 관련 세 비트만 바꾼다.
    const properties = (2 << 2) | (2 << 5) | (code << 8)
    const fill = parseBorder(properties)
    expect(fill.slashCrooked).toBe(slash)
    expect(fill.backSlashCrooked).toBe(backSlash)
    expect(fill.backSlashCrookedSpec).toBe(spec)
    expect(writeBorder(fill)).toEqual(payload(properties))
  })
})


describe('대각선 선 종류', () => {
  // 명세 표 27(Slash/BackSlash/CrookedSlash)과 달리 LineStyle이다. 한글에서 점선으로 바꾸면 3.
  it.each([
    [LineStyle.None, 0],
    [LineStyle.Solid, 1],
    [LineStyle.Dotted, 3],
  ])('대각선 종류 %s를 원시 값 %s로 기록하고 읽는다', (style, code) => {
    const fill = parseBorder(0)
    fill.diagonal = { style, width: 9, color: parseColor(0x123456) }
    const bytes = writeBorder(fill)
    expect([...bytes.slice(26, 32)]).toEqual([code, 9, 0x12, 0x34, 0x56, 0])
    const doc = createDocument({ borderFills: [] })
    parseDocInfo(doc, serializeRecords([{ tagId: DocInfoTag.BorderFill, level: 1, payload: bytes }]))
    expect(doc.borderFills[0]?.diagonal).toEqual({ style, width: 9, color: parseColor(0x123456) })
  })

  it('대각선이 없으면 한글 빈 문서의 기본값(실선)을 기록한다', () => {
    const fill = parseBorder(0)
    delete fill.diagonal
    expect([...writeBorder(fill).slice(26, 32)]).toEqual([1, 0, 0, 0, 0, 0])
  })
})

describe('표 28 채우기 정보', () => {
  const head = payload(0).slice(0, 32)
  const fillBytes = (fill: ReturnType<typeof parseBorder>['fill']) => {
    const border = parseBorder(0)
    border.fill = fill
    return writeBorder(border).slice(32)
  }
  const parseTail = (tail: number[]) => {
    const doc = createDocument({ borderFills: [] })
    parseDocInfo(doc, serializeRecords([{ tagId: DocInfoTag.BorderFill, level: 1, payload: new Uint8Array([...head, ...tail]) }]))
    return doc.borderFills[0]!.fill!
  }
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]

  // 실제 HWP 샘플의 BorderFill: 단색, 무늬 없음, 추가 속성 0, 투명도 1바이트.
  const sampleTail = [1, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0x99, 0x99, 0x99, 0, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0]
  // macOS 한글이 저장한 그러데이션: 빨강→파랑 계열, 기울임 90, 중심 0/0, 번짐 정도 255, 번짐 중심 50.
  const gradientTail = [
    4, 0, 0, 0, 1, ...u32(90), ...u32(0), ...u32(0), ...u32(255), ...u32(2),
    0x86, 0xaf, 0xdc, 0, 0x2d, 0x62, 0x9c, 0, ...u32(1), 50, 0,
  ]
  // macOS 한글이 저장한 이미지: 원래 크기에 비례하여, 명암 75, 밝기 50, BinItem 1.
  const imageTail = [2, 0, 0, 0, 15, 75, 50, 0, 1, 0, ...u32(0), 0]

  it('한글이 쓴 단색 채우기의 배치를 읽는다', () => {
    expect(parseTail(sampleTail)).toEqual({
      color: { background: NO_COLOR, pattern: { style: -1, color: parseColor(0x999999) }, transparency: 0 },
    })
  })

  it('한글이 쓴 단색 채우기를 같은 바이트로 쓴다', () => {
    expect([...fillBytes(parseTail(sampleTail))]).toEqual(sampleTail)
  })

  it('한글이 쓴 그러데이션 채우기를 읽고 같은 바이트로 쓴다', () => {
    const fill = parseTail(gradientTail)
    expect(fill).toEqual({
      gradient: {
        type: 1, angle: 90, centerX: 0, centerY: 0, step: 255,
        colors: [parseColor(0x86afdc), parseColor(0x2d629c)], stops: undefined, stepCenter: 50, transparency: 0,
      },
    })
    expect([...fillBytes(fill)]).toEqual(gradientTail)
  })

  it('한글이 쓴 이미지 채우기를 명암·밝기 순으로 읽고 같은 바이트로 쓴다', () => {
    const fill = parseTail(imageTail)
    expect(fill).toEqual({
      image: { mode: 15, contrast: 75, brightness: 50, effect: 0, binDataId: 0, transparency: 0 },
    })
    expect([...fillBytes(fill)]).toEqual(imageTail)
  })

  it('채우기가 없으면 종류와 추가 속성 길이만 쓴다', () => {
    expect([...fillBytes(NO_FILL)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  describe('여러 비트가 켜진 채우기는 모든 블록과 투명도를 남기고 같은 바이트로 쓴다', () => {
    const color = [0x11, 0x22, 0x33, 0, 0x44, 0x55, 0x66, 0, ...u32(2)]
    const gradient = gradientTail.slice(4, 4 + 29)
    const image = imageTail.slice(4, 10)
    const build = (kind: number) => [
      ...u32(kind),
      ...(kind & 1 ? color : []), ...(kind & 4 ? gradient : []), ...(kind & 2 ? image : []),
      ...(kind & 4 ? [...u32(1), 50] : u32(0)),
      ...[1, 4, 2].filter(bit => kind & bit).map((bit) => 10 + bit),
    ]
    it.each([3, 5, 6, 7])('종류 %s', (kind) => {
      const fill = parseTail(build(kind))
      expect(Boolean(fill.color)).toBe(Boolean(kind & 1))
      expect(Boolean(fill.image)).toBe(Boolean(kind & 2))
      expect(Boolean(fill.gradient)).toBe(Boolean(kind & 4))
      // 앞 블록 뒤에서도 값이 어긋나지 않고, 투명도는 블록 순서(단색, 그러데이션, 그림)로 붙는다.
      if (fill.color) expect([fill.color.pattern.style, fill.color.transparency]).toEqual([2, 11])
      if (fill.gradient) expect([fill.gradient.step, fill.gradient.stepCenter, fill.gradient.transparency]).toEqual([255, 50, 14])
      if (fill.image) expect([fill.image.contrast, fill.image.brightness, fill.image.binDataId, fill.image.transparency]).toEqual([75, 50, 0, 12])
      expect([...fillBytes(fill)]).toEqual(build(kind))
    })
  })

  it('추가 채우기 속성의 모르는 바이트를 보존한다', () => {
    const tail = [1, 0, 0, 0, ...new Array(12).fill(0), ...u32(2), 7, 8, 0]
    const fill = parseTail(tail)
    expect([...fill.extraProperties!]).toEqual([7, 8])
    expect([...fillBytes(fill)]).toEqual(tail)
    const gradientExtra = [...gradientTail.slice(0, 33), ...u32(2), 50, 9, 0]
    expect([...fillBytes(parseTail(gradientExtra))]).toEqual(gradientExtra)
  })

  it('이미지 채우기의 BinItem ID는 1부터 기록한다', () => {
    const bytes = fillBytes({ image: { mode: 0, brightness: 0, contrast: 0, effect: 0, binDataId: 2 } })
    expect([...bytes.slice(0, 10)]).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 3, 0])
  })
})

describe('여러 종류가 켜진 BorderFill (experiments/fill-multi-kind-priority)', () => {
  const dir = join(__dirname, '../../../docs/experiments/fill-multi-kind-priority')
  const borderFills = (bytes: Uint8Array): string[] => {
    const c = CFB.read(bytes, { type: 'buffer' })
    const compressed = ((CFB.find(c, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
    const data = maybeInflate(new Uint8Array(CFB.find(c, 'DocInfo')!.content as Uint8Array), compressed)
    return parseRecords(data)
      .filter((r) => r.tagId === DocInfoTag.BorderFill)
      .map((r) => Buffer.from(r.payload).toString('hex'))
  }

  // Windows 한글 2024는 이 파일들을 열고 다시 저장해도 BorderFill을 바꾸지 않았다(windows-2024/).
  it.each(['3-color-image', '5-color-gradient', '6-gradient-image', '7-all'])('%s를 원본과 같은 바이트로 쓴다', (name) => {
    const bytes = new Uint8Array(readFileSync(join(dir, `${name}.hwp`)))
    const resaved = new Uint8Array(readFileSync(join(dir, 'windows-2024', `${name}.hwp`)))
    expect(borderFills(resaved)).toEqual(borderFills(bytes))
    expect(borderFills(serializeHwp(parseHwp(bytes)))).toEqual(borderFills(bytes))
    const fill = parseHwp(bytes).borderFills[3]!.fill!
    const kind = Number(name[0])
    expect([Boolean(fill.color), Boolean(fill.image), Boolean(fill.gradient)]).toEqual([
      Boolean(kind & 1), Boolean(kind & 2), Boolean(kind & 4),
    ])
  })
})
