import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ArrowSize,
  ArrowStyle,
  FillKind,
  HatchStyle,
  LineEndCap,
  LineStyle,
  OutlineStyle,
  type Control,
  type Fill,
  type ShapeComponent,
  type ShapeLine,
} from '@js-hwp/core'
import CFB from 'cfb'
import { describe, expect, it } from 'vitest'
import { readShapeComponent, writeShapeComponent } from '../src/bodytext.js'
import { maybeInflate } from '../src/compress.js'
import { parseHwp, serializeHwp } from '../src/document.js'
import { buildRecordTree, parseRecords, type RecordNode } from '../src/record.js'
import { SectionTag } from '../src/tags.js'

const root = join(__dirname, '../../..')
const files = ['docs/experiments', 'fixtures', 'scratch'].flatMap((d) =>
  readdirSync(join(root, d), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.hwp'))
    .map((f) => join(root, d, f)),
)

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')

/** 모든 SHAPE_COMPONENT 페이로드(16진수)를 나온 순서대로. */
function shapeComponents(bytes: Uint8Array): string[] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  const out: string[] = []
  const walk = (n: RecordNode): void => {
    if (n.tagId === SectionTag.ShapeComponent) out.push(hex(n.payload))
    n.children.forEach(walk)
  }
  for (const p of c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p))) {
    const data = new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array)
    buildRecordTree(parseRecords(maybeInflate(data, compressed))).forEach(walk)
  }
  return out
}

type Gso = Extract<Control, { type: 'unknown' }>

/** 첫 구역 문단에 놓인 `gso ` 컨트롤. */
function drawingObjects(doc: ReturnType<typeof parseHwp>): Gso[] {
  return doc.sections[0]!.paragraphs
    .flatMap((p) => p.runs.flatMap((r) => r.items))
    .filter((i): i is Gso => i.type === 'unknown' && i.ctrlId === 'gso ')
}

const load = (path: string) => parseHwp(new Uint8Array(readFileSync(join(root, path))))

describe('저장소 HWP 파일의 SHAPE_COMPONENT', () => {
  const withShapes = files.filter((f) => shapeComponents(new Uint8Array(readFileSync(f))).length > 0)

  it('그리기 개체가 든 파일이 있다', () => {
    expect(withShapes.length).toBeGreaterThan(0)
  })

  // 원본 비트 보존: 개체 요소 속성을 모델로 읽고 다시 쓴 레코드가 원본과 바이트 단위로 같아야 한다.
  it.each(withShapes.map((f) => [f.slice(root.length + 1), f]))('%s 왕복', (_, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    expect(shapeComponents(serializeHwp(parseHwp(bytes)))).toEqual(shapeComponents(bytes))
  })

  it.each(withShapes.map((f) => [f.slice(root.length + 1), f]))('%s 모델로 읽음', (_, file) => {
    const payloads = shapeComponents(new Uint8Array(readFileSync(file)))
    for (const p of payloads) {
      const shape = readShapeComponent(Buffer.from(p, 'hex'))
      expect(shape).toBeDefined()
      // 저장소의 그리기 개체는 사각형뿐이고, 모두 테두리 선과 채우기를 모델로 읽는다.
      if (shape!.shapeId === '$rec') {
        expect(shape!.line).toBeDefined()
        expect(shape!.fill).toBeDefined()
        expect(shape!.trailing).toHaveLength(22)
      }
    }
  })
})

describe('개체 요소 속성 값 (한글 2024)', () => {
  it('사각형: 크기, 명세에 없는 비트, 표 81 바이트', () => {
    const [rect] = drawingObjects(load('docs/experiments/object-common-props/rect-caption-bottom.hwp'))
    const shape = rect!.shapeComponent!
    expect(shape).toMatchObject({
      shapeId: '$rec',
      groupOffsetX: 0,
      groupOffsetY: 0,
      groupLevel: 0,
      localVersion: 1,
      initialWidth: 19298,
      initialHeight: 13515,
      width: 19300,
      height: 13514,
      unknownBits: 0x80000,
      rotation: 0,
      rotationCenter: { x: 9650, y: 6757 },
      translation: [1, 0, 0, 0, 1, 0],
    })
    expect(shape.flipHorizontal).toBeUndefined()
    expect(shape.scaleRotations).toHaveLength(1)
    // 크기를 바꾼 만큼 scale matrix가 1에서 벗어난다.
    expect(shape.scaleRotations[0]!.scale[0]).toBeCloseTo(19300 / 19298, 10)
    expect(shape.scaleRotations[0]!.rotation).toEqual([1, 0, 0, 0, 1, 0])
    // 한글 기본 사각형의 테두리 선: 검정 0.12mm 실선, Flat, 화살표 중간-중간 채움.
    expect(shape.line).toEqual({
      color: { r: 0, g: 0, b: 0, unknown: 0 },
      width: 33,
      style: LineStyle.Solid,
      endCap: LineEndCap.Flat,
      startArrow: ArrowStyle.None,
      endArrow: ArrowStyle.None,
      startArrowSize: ArrowSize.MediumMedium,
      endArrowSize: ArrowSize.MediumMedium,
      startArrowFill: true,
      endArrowFill: true,
      outlineStyle: OutlineStyle.Normal,
    })
    // 테두리 선 뒤의 채우기 정보 21바이트: 흰색 단색, 무늬 없음.
    expect(shape.fill).toEqual({
      kind: FillKind.Color,
      background: { r: 0xff, g: 0xff, b: 0xff, unknown: 0 },
      pattern: { style: HatchStyle.None, color: { r: 0, g: 0, b: 0, unknown: 0 } },
      unknown: 0,
    })
    // 그 뒤의 명세에 없는 22바이트. 회색 b2b2b2가 보인다(그림자로 추정).
    expect(shape.trailing).toHaveLength(56 - 13 - 21)
    expect(hex(shape.trailing!.subarray(4, 8))).toBe('b2b2b200')
    // SHAPE_COMPONENT는 childRecords에 없고, 그 자식(도형별 레코드)은 깊이 1로 남는다.
    expect(rect!.childRecords?.map((r) => [r.tagId, r.depth])).toEqual([
      [SectionTag.ShapeComponentRectangle, 1],
    ])
  })

  it('그림: Rendering 정보에서 레코드가 끝난다', () => {
    const doc = load('docs/experiments/bullet-image-id/base.hwp')
    const pic = drawingObjects(doc).find((c) => c.shapeComponent?.shapeId === '$pic')!
    expect(pic.shapeComponent).toMatchObject({ width: 7381, height: 4500, unknownBits: 0x24080000 })
    expect(pic.shapeComponent!.line).toBeUndefined()
    expect(pic.shapeComponent!.fill).toBeUndefined()
    expect(pic.shapeComponent!.trailing).toBeUndefined()
  })
})

describe('읽은 테두리 선을 고치면', () => {
  it('테두리 선 13바이트만 바뀌고 나머지는 그대로다', () => {
    const path = 'docs/experiments/object-common-props/rect-caption-bottom.hwp'
    const bytes = new Uint8Array(readFileSync(join(root, path)))
    const doc = parseHwp(bytes)
    const line = drawingObjects(doc)[0]!.shapeComponent!.line!
    line.color = { r: 0x12, g: 0x34, b: 0x56, unknown: 0 }
    line.width = 283
    line.style = LineStyle.Dashed
    line.endArrow = ArrowStyle.Arrow
    line.startArrowFill = false
    line.outlineStyle = OutlineStyle.Inner

    const [before] = shapeComponents(bytes).map((h) => Buffer.from(h, 'hex'))
    const [after] = shapeComponents(serializeHwp(doc)).map((h) => Buffer.from(h, 'hex'))
    // ID 8 + 개체 요소 속성 42 + 행렬 쌍 수 2 + 행렬 48×3 뒤가 테두리 선이다.
    const at = 8 + 42 + 2 + 48 * 3
    expect(after!.subarray(at, at + 13).toString('hex')).toBe(
      '12345600' + '1b010000' + Buffer.from(Uint32Array.of(0x91010042).buffer).toString('hex') + '02',
    )
    expect(hex(after!.subarray(0, at))).toBe(hex(before!.subarray(0, at)))
    expect(hex(after!.subarray(at + 13))).toBe(hex(before!.subarray(at + 13)))
  })
})

describe('읽은 개체 요소 속성을 고치면', () => {
  it('고친 필드만 바뀌고 나머지 바이트와 하위 레코드는 그대로다', () => {
    const path = 'docs/experiments/object-common-props/rect-caption-bottom.hwp'
    const bytes = new Uint8Array(readFileSync(join(root, path)))
    const doc = parseHwp(bytes)
    const [rect] = drawingObjects(doc)
    rect!.shapeComponent!.flipHorizontal = true
    rect!.shapeComponent!.width = 20000

    const [before] = shapeComponents(bytes).map((h) => Buffer.from(h, 'hex'))
    const [after] = shapeComponents(serializeHwp(doc)).map((h) => Buffer.from(h, 'hex'))
    // 오프셋은 ID 8바이트 뒤 개체 요소 속성 기준: 현재 폭 20, 속성 28.
    expect(after!.readUInt32LE(8 + 20)).toBe(20000)
    expect(after!.readUInt32LE(8 + 28)).toBe(0x80001)
    after!.writeUInt32LE(before!.readUInt32LE(8 + 20), 8 + 20)
    after!.writeUInt32LE(before!.readUInt32LE(8 + 28), 8 + 28)
    expect(hex(after!)).toBe(hex(before!))
  })
})

describe('읽은 채우기를 고치면', () => {
  it('채우기 바이트만 바뀌고 나머지는 그대로다', () => {
    const path = 'docs/experiments/object-common-props/rect-caption-bottom.hwp'
    const bytes = new Uint8Array(readFileSync(join(root, path)))
    const doc = parseHwp(bytes)
    const shape = drawingObjects(doc)[0]!.shapeComponent!
    const fill = shape.fill as Extract<Fill, { kind: FillKind.Color }>
    fill.background = { r: 0x12, g: 0x34, b: 0x56, unknown: 0 }

    const [before] = shapeComponents(bytes).map((h) => Buffer.from(h, 'hex'))
    const [after] = shapeComponents(serializeHwp(doc)).map((h) => Buffer.from(h, 'hex'))
    // 테두리 선 뒤 채우기 종류 4바이트 다음이 배경색이다.
    const at = 8 + 42 + 2 + 48 * 3 + 13 + 4
    expect(hex(after!.subarray(at, at + 4))).toBe('12345600')
    after!.set(before!.subarray(at, at + 4), at)
    expect(hex(after!)).toBe(hex(before!))
  })

  it('채우기 없음으로 바꾸면 종류와 추가 속성 길이만 쓴다', () => {
    const path = 'docs/experiments/object-common-props/rect-caption-bottom.hwp'
    const doc = parseHwp(new Uint8Array(readFileSync(join(root, path))))
    const shape = drawingObjects(doc)[0]!.shapeComponent!
    shape.fill = { kind: FillKind.None }
    const [after] = shapeComponents(serializeHwp(doc)).map((h) => Buffer.from(h, 'hex'))
    const at = 8 + 42 + 2 + 48 * 3 + 13
    expect(hex(after!.subarray(at, at + 8))).toBe('0000000000000000')
    expect(hex(after!.subarray(at + 8))).toBe(hex(shape.trailing!))
  })
})

describe('readShapeComponent', () => {
  const sample = (): ShapeComponent => ({
    shapeId: '$rec',
    groupOffsetX: 0,
    groupOffsetY: 0,
    groupLevel: 0,
    localVersion: 1,
    initialWidth: 100,
    initialHeight: 50,
    width: 100,
    height: 50,
    rotation: 0,
    rotationCenter: { x: 50, y: 25 },
    translation: [1, 0, 0, 0, 1, 0],
    scaleRotations: [{ scale: [1, 0, 0, 0, 1, 0], rotation: [1, 0, 0, 0, 1, 0] }],
  })

  it('쓴 레코드를 다시 읽으면 같다', () => {
    const bytes = writeShapeComponent(sample()).finish()
    expect(bytes).toHaveLength(8 + 42 + 2 + 48 * 3)
    expect(readShapeComponent(bytes)).toEqual(sample())
  })

  it('ID가 두 번 오지 않으면 해석하지 않는다', () => {
    const bytes = writeShapeComponent(sample()).finish()
    bytes[4] = 0
    expect(readShapeComponent(bytes)).toBeUndefined()
  })

  it('행렬보다 짧은 레코드는 해석하지 않는다', () => {
    const bytes = writeShapeComponent(sample()).finish()
    expect(readShapeComponent(bytes.subarray(0, bytes.length - 1))).toBeUndefined()
    expect(readShapeComponent(bytes.subarray(0, 20))).toBeUndefined()
  })

  it('유한하지 않은 행렬 원소가 있으면 해석하지 않는다', () => {
    const bytes = writeShapeComponent(sample()).finish()
    new DataView(bytes.buffer, bytes.byteOffset).setFloat64(52, Number.NaN, true)
    expect(readShapeComponent(bytes)).toBeUndefined()
  })

  const line = (): ShapeLine => ({
    color: { r: 0, g: 0, b: 0, unknown: 0 },
    width: 33,
    style: LineStyle.Solid,
    endCap: LineEndCap.Flat,
    startArrow: ArrowStyle.None,
    endArrow: ArrowStyle.None,
    startArrowSize: ArrowSize.MediumMedium,
    endArrowSize: ArrowSize.MediumMedium,
    startArrowFill: true,
    endArrowFill: true,
    outlineStyle: OutlineStyle.Normal,
  })

  it('그리기 개체의 테두리 선을 쓰고 다시 읽는다', () => {
    const shape = { ...sample(), line: line(), trailing: Uint8Array.of(1, 2, 3) }
    const bytes = writeShapeComponent(shape).finish()
    expect(bytes).toHaveLength(8 + 42 + 2 + 48 * 3 + 13 + 3)
    expect(readShapeComponent(bytes)).toEqual(shape)
  })

  it('그리기 개체가 아니면 테두리 선으로 읽지 않는다', () => {
    const shape = { ...sample(), shapeId: '$pic', trailing: new Uint8Array(13) }
    expect(readShapeComponent(writeShapeComponent(shape).finish())).toEqual(shape)
  })

  it('테두리 선보다 짧으면 테두리 선으로 읽지 않는다', () => {
    const shape = { ...sample(), trailing: new Uint8Array(12) }
    expect(readShapeComponent(writeShapeComponent(shape).finish())).toEqual(shape)
  })

  const lineBytes = (): Uint8Array => {
    const written = writeShapeComponent({ ...sample(), line: line() }).finish()
    return written.subarray(8 + 42 + 2 + 48 * 3)
  }
  const withTail = (tail: number[]): Uint8Array => {
    const head = writeShapeComponent({ ...sample(), line: line() }).finish()
    return Uint8Array.from([...head, ...tail])
  }

  it('채우기를 쓰고 다시 읽는다', () => {
    const shape: ShapeComponent = {
      ...sample(),
      line: line(),
      fill: {
        kind: FillKind.Color,
        background: { r: 1, g: 2, b: 3, unknown: 0 },
        pattern: { style: HatchStyle.None, color: { r: 0, g: 0, b: 0, unknown: 0 } },
        unknown: 0,
      },
      trailing: Uint8Array.of(9, 9),
    }
    const bytes = writeShapeComponent(shape).finish()
    expect(bytes).toHaveLength(8 + 42 + 2 + 48 * 3 + 13 + 21 + 2)
    expect(readShapeComponent(bytes)).toEqual(shape)
  })

  it('다시 쓰면 바이트가 달라지는 채우기는 trailing에 원본 그대로 남긴다', () => {
    expect(lineBytes()).toHaveLength(13)
    // 단색과 이미지가 함께 켜진 채우기(종류 3). 리더는 이미지 하나만 남긴다.
    const multi = [
      3, 0, 0, 0, ...[255, 255, 255, 0], ...[0, 0, 0, 0], ...[255, 255, 255, 255],
      ...[0, 0, 0, 0, 1, 0], ...[0, 0, 0, 0], 0, 0,
    ]
    const shape = readShapeComponent(withTail(multi))!
    expect(shape.line).toEqual(line())
    expect(shape.fill).toBeUndefined()
    expect([...shape.trailing!]).toEqual(multi)
    // 추가 채우기 속성에 모르는 바이트가 있는 단색 채우기.
    const extra = [1, 0, 0, 0, ...new Array(12).fill(0), 2, 0, 0, 0, 7, 7, 0]
    expect([...readShapeComponent(withTail(extra))!.trailing!]).toEqual(extra)
    // 단색 블록 중간에서 끝나는 짧은 채우기.
    const short = [1, 0, 0, 0, 255, 255]
    const shortShape = readShapeComponent(withTail(short))!
    expect(shortShape.fill).toBeUndefined()
    expect([...shortShape.trailing!]).toEqual(short)
  })

  it('비트 필드를 넘는 테두리 선 값은 쓰지 않는다', () => {
    const write = (patch: Partial<ShapeLine>) => () =>
      writeShapeComponent({ ...sample(), line: { ...line(), ...patch } })
    expect(write({ style: 64 as LineStyle })).toThrow(RangeError)
    expect(write({ endCap: 16 as LineEndCap })).toThrow(RangeError)
    expect(write({ endArrow: -1 as ArrowStyle })).toThrow(RangeError)
    expect(write({ startArrowSize: 16 as ArrowSize })).toThrow(RangeError)
    expect(write({ outlineStyle: 256 as OutlineStyle })).toThrow(RangeError)
    expect(write({ width: 2 ** 31 })).toThrow(RangeError)
    expect(write({ endArrow: 63 as ArrowStyle })).not.toThrow()
  })

  it('잘못된 값은 쓰지 않는다', () => {
    expect(() => writeShapeComponent({ ...sample(), shapeId: '$re' })).toThrow(RangeError)
    expect(() => writeShapeComponent({ ...sample(), width: -1 })).toThrow(RangeError)
    expect(() => writeShapeComponent({ ...sample(), translation: [1, 0, 0, 0, 1, Infinity] })).toThrow(
      RangeError,
    )
  })
})
