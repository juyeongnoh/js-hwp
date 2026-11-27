import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BinDataType, DocumentBuilder, ImageEffect, walkControls, type Control, type GroupChild, type PictureControl } from '@js-hwp/core'
import CFB from 'cfb'
import { describe, expect, it } from 'vitest'
import { readPictureShape, writePictureShape } from '../src/bodytext.js'
import { maybeInflate } from '../src/compress.js'
import { parseHwp, serializeHwp } from '../src/document.js'
import { buildRecordTree, parseRecords, type RecordNode } from '../src/record.js'
import { DocInfoTag, SectionTag } from '../src/tags.js'

const root = join(__dirname, '../../..')
const files = ['docs/experiments', 'fixtures', 'scratch'].flatMap((d) =>
  readdirSync(join(root, d), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.hwp'))
    .map((f) => join(root, d, f)),
)

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

/** 모든 SHAPE_COMPONENT_PICTURE 페이로드를 나온 순서대로. */
function pictureRecords(bytes: Uint8Array): Uint8Array[] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  const out: Uint8Array[] = []
  const walk = (n: RecordNode): void => {
    if (n.tagId === SectionTag.ShapeComponentPicture) out.push(n.payload)
    n.children.forEach(walk)
  }
  for (const p of c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p))) {
    const data = new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array)
    buildRecordTree(parseRecords(maybeInflate(data, compressed))).forEach(walk)
  }
  return out
}

/** 문서의 그림. 묶음 안 그림(`placement`가 없다)도 넣는다. */
const pictures = (bytes: Uint8Array): Omit<PictureControl, 'placement'>[] => {
  const out: Omit<PictureControl, 'placement'>[] = []
  const visit = (c: Control | GroupChild): void => {
    if (c.type === 'picture') out.push(c)
    else if (c.type === 'container') c.children.forEach(visit)
  }
  for (const c of walkControls(parseHwp(bytes))) visit(c)
  return out
}

const experiment = (name: string) => {
  const bytes = new Uint8Array(readFileSync(join(root, `docs/experiments/shape-picture/${name}.hwp`)))
  const [picture, ...rest] = pictures(bytes)
  expect(rest).toEqual([])
  return picture!
}

describe('그림 개체 속성 (experiments/shape-picture, 한글 2024)', () => {
  it('default: 그림 넣기만 한 기본값', () => {
    const p = experiment('default')
    expect(pictureRecords(new Uint8Array(readFileSync(join(root, 'docs/experiments/shape-picture/default.hwp'))))[0]).toHaveLength(91)
    expect(p).toMatchObject({
      width: 9000,
      height: 6000,
      unknownBits: 0x24080000,
      border: {
        color: { r: 0, g: 0, b: 0, unknown: 0 },
        width: 33,
        style: 0,
        endCap: 1,
        startArrowSize: 4,
        endArrowSize: 4,
        startArrowFill: true,
        endArrowFill: true,
      },
      borderTransparency: 0,
      points: [
        { x: 0, y: 0 },
        { x: 9000, y: 0 },
        { x: 9000, y: 6000 },
        { x: 0, y: 6000 },
      ],
      crop: { left: 0, top: 0, right: 9000, bottom: 6000 },
      innerMargins: { left: 0, right: 0, top: 0, bottom: 0 },
      contrast: 0,
      brightness: 0,
      effect: ImageEffect.RealPicture,
      binDataId: 0,
      pictureInstanceId: 182350166,
      effects: {},
      originalSize: { width: 9000, height: 6000 },
      transparency: 0,
    })
    expect(p.pictureTrailing).toBeUndefined()
  })

  it('picture-line: 자르기·여백·밝기·명암·투명도와 테두리', () => {
    const p = experiment('picture-line')
    // 자르면 현재 크기가 자른 크기가 되고, 꼭짓점과 원본 크기는 그대로다.
    expect(p).toMatchObject({ width: 7867, height: 4301 })
    expect(p.points[2]).toEqual({ x: 9000, y: 6000 })
    // 자르기 왼1·위2·오른3·아래4mm: 원본 이미지 좌표.
    expect(p.crop).toEqual({ left: 283, top: 566, right: 9000 - 850, bottom: 6000 - 1133 })
    // 여백 왼1·오른2·위3·아래4mm.
    expect(p.innerMargins).toEqual({ left: 283, right: 566, top: 850, bottom: 1133 })
    expect(p.brightness).toBe(3)
    expect(p.contrast).toBe(-2)
    expect(p.transparency).toBe(13) // 5%
    expect(p.border).toMatchObject({ color: { r: 255, g: 0, b: 0 }, style: 2, width: 850 })
    expect(p.borderTransparency).toBe(18) // 7%
    expect(p.effects).toEqual({})
  })

  it('effect-shadow: 그림자', () => {
    const { shadow } = experiment('effect-shadow').effects!
    expect(shadow).toMatchObject({
      style: 0,
      blur: 800,
      direction: 47,
      distance: 700,
      align: 4,
      skewX: 4,
      skewY: 0,
      scaleX: 1,
      rotateWithShape: 0,
      color: { rgb: { r: 0, g: 0, b: 255, unknown: 0 }, effects: [] },
    })
    expect(shadow!.transparency).toBeCloseTo(0.53, 6)
    expect(shadow!.scaleY).toBeCloseTo(1.01, 6)
  })

  it('effect-reflection: 반사 56바이트', () => {
    const { reflection } = experiment('effect-reflection').effects!
    expect(reflection).toMatchObject({
      align: 6,
      radius: 50,
      direction: 90,
      distance: 700,
      scaleX: 1,
      scaleY: -1,
      startTransparency: 0.5,
      startPosition: 0,
      fadeDirection: 90,
    })
    expect(reflection!.endPosition).toBeCloseTo(0.77, 6)
  })

  it('effect-all: 네온과 옅은 테두리, SAT_MOD 516', () => {
    const effects = experiment('effect-all').effects!
    expect(Object.keys(effects)).toEqual(['shadow', 'glow', 'softEdge', 'reflection'])
    expect(effects.glow).toMatchObject({
      radius: 1100,
      color: { rgb: { r: 255, g: 132, b: 58 }, effects: [{ kind: 516, value: 1.75 }] },
    })
    expect(effects.glow!.transparency).toBeCloseTo(0.52, 6)
    expect(effects.softEdge).toBe(800)
  })

  it('gray-invert: 회색조는 효과 1, 그림 반전은 개체 요소 속성 bit 24', () => {
    const p = experiment('gray-invert')
    expect(p.effect).toBe(ImageEffect.GrayScale)
    expect(p.unknownBits).toBe(0x24080000 | (1 << 24))
  })

  it('bw-watermark: 흑백은 효과 2, 워터마크는 밝기 70·명암 -50', () => {
    const p = experiment('bw-watermark')
    expect(p.effect).toBe(ImageEffect.BlackWhite)
    expect(p.brightness).toBe(70)
    expect(p.contrast).toBe(-50)
  })
})

describe('저장소 HWP 파일의 그림 레코드 왕복', () => {
  const withPictures = files.filter((f) => pictureRecords(new Uint8Array(readFileSync(f))).length > 0)

  it('저장소에 90바이트와 91바이트 그림 레코드가 있다', () => {
    const lengths = new Set(
      withPictures.flatMap((f) => pictureRecords(new Uint8Array(readFileSync(f))).map((p) => p.length)),
    )
    expect(lengths).toContain(90)
    expect(lengths).toContain(91)
  })

  it.each(withPictures.map((f) => [f.slice(root.length + 1), f]))('%s', (_, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    const records = pictureRecords(bytes)
    const parsed = pictures(bytes)
    // 모든 그림을 모델로 읽고, 남는 바이트가 없다.
    expect(parsed).toHaveLength(records.length)
    for (const p of parsed) {
      expect(p.pictureTrailing).toBeUndefined()
      expect(p.effects).toBeDefined()
      expect(p.originalSize).toBeDefined()
    }
    expect(pictureRecords(serializeHwp(parseHwp(bytes))).map(hex)).toEqual(records.map(hex))
  })
})

describe('읽지 못하는 그림 효과는 pictureTrailing에 원본 그대로', () => {
  const effectAll = pictureRecords(
    new Uint8Array(readFileSync(join(root, 'docs/experiments/shape-picture/effect-all.hwp'))),
  )[0]!
  const roundTrip = (payload: Uint8Array) => {
    const picture = readPictureShape(payload)!
    expect(hex(writePictureShape(picture).finish())).toBe(hex(payload))
    return picture
  }

  it('효과를 모두 읽으면 남는 바이트가 없다', () => {
    const p = roundTrip(effectAll)
    expect(p.pictureTrailing).toBeUndefined()
    expect(p.transparency).toBe(13)
  })

  it('모르는 효과 플래그 비트', () => {
    const payload = effectAll.slice()
    payload[78] = payload[78]! | 0x10
    const p = roundTrip(payload)
    expect(p.effects).toBeUndefined()
    expect(p.originalSize).toBeUndefined()
    expect(p.pictureTrailing).toEqual(payload.subarray(78))
  })

  it('RGB가 아닌 색 타입', () => {
    const payload = effectAll.slice()
    // 그림자 블록 44바이트 뒤가 색상 타입이다.
    new DataView(payload.buffer).setInt32(78 + 4 + 44, 1, true)
    const p = roundTrip(payload)
    expect(p.effects).toBeUndefined()
    expect(p.pictureTrailing).toEqual(payload.subarray(78))
  })

  it('효과 중간에서 끝나는 짧은 레코드', () => {
    const payload = effectAll.slice(0, 100)
    const p = roundTrip(payload)
    expect(p.effects).toBeUndefined()
    expect(p.pictureTrailing).toEqual(payload.subarray(78))
  })

  it('효과 플래그가 없는 78바이트 레코드', () => {
    const p = roundTrip(effectAll.slice(0, 78))
    expect(p.effects).toBeUndefined()
    expect(p.pictureTrailing).toBeUndefined()
  })

  it('78바이트보다 짧으면 읽지 않는다', () => {
    expect(readPictureShape(effectAll.slice(0, 77))).toBeUndefined()
  })
})

/** DocInfo의 BIN_DATA 페이로드(16진수). */
function binDataRecords(bytes: Uint8Array): string[] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const compressed = ((CFB.find(c, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
  const docInfo = maybeInflate(new Uint8Array(CFB.find(c, 'DocInfo')!.content as Uint8Array), compressed)
  return parseRecords(docInfo)
    .filter((r) => r.tagId === DocInfoTag.BinData)
    .map((r) => hex(r.payload))
}

describe('그림의 BinData (표 17)', () => {
  const file = join(root, 'docs/experiments/shape-picture/default.hwp')
  const bytes = new Uint8Array(readFileSync(file))

  it('한글이 넣은 그림은 EMBEDDING(1), 압축 안 함이고 그림이 그 항목을 가리킨다', () => {
    expect(binDataRecords(bytes)).toEqual(['21000100030070006e006700'])
    const doc = parseHwp(bytes)
    expect(doc.binData).toHaveLength(1)
    expect(doc.binData[0]).toMatchObject({ type: BinDataType.Embedding, compressed: false, extension: 'png' })
    const png = new Uint8Array(readFileSync(join(root, 'docs/experiments/shape-picture/quadrants.png')))
    expect(doc.binData[0]!.data).toEqual(png)
    expect(pictures(bytes)[0]!.binDataId).toBe(0)
  })

  it('BIN_DATA 레코드와 압축하지 않은 BinData 스트림을 그대로 쓴다', () => {
    const out = serializeHwp(parseHwp(bytes))
    expect(binDataRecords(out)).toEqual(binDataRecords(bytes))
    const stream = (b: Uint8Array) =>
      hex(CFB.find(CFB.read(b, { type: 'buffer' }), '/BinData/BIN0001.png')!.content as Uint8Array)
    expect(stream(out)).toBe(stream(bytes))
  })

  it('빌더 그림은 EMBEDDING으로 쓴다', () => {
    const png = new Uint8Array(readFileSync(join(root, 'docs/experiments/shape-picture/quadrants.png')))
    const out = serializeHwp(new DocumentBuilder().image(png).build())
    // 속성 0x0001: EMBEDDING, 압축은 저장소 기본값. BinItem ID 1, 확장자 png.
    expect(binDataRecords(out)).toEqual(['01000100030070006e006700'])
    const doc = parseHwp(out)
    expect(doc.binData[0]).toMatchObject({ type: BinDataType.Embedding, extension: 'png', data: png })
    expect(pictures(out)[0]).toMatchObject({ binDataId: 0, originalSize: { width: 9000, height: 6000 } })
  })
})
