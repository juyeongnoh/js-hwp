import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CaptionSide,
  DocumentBuilder,
  ListLineWrap,
  NumberingKind,
  RelativeTo,
  TextDirection,
  TextWrap,
  VerticalAlign,
  type Control,
} from '@js-hwp/core'
import CFB from 'cfb'
import { describe, expect, it } from 'vitest'
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

const OBJECTS = new Set(['tbl ', 'gso ', 'eqed'])

/** 개체 컨트롤(`tbl `, `gso `, `eqed`)의 CTRL_HEADER 페이로드를 나온 순서대로. `gso ` 안(글상자 등)도 포함한다. */
function objectHeaders(bytes: Uint8Array): string[] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  const out: string[] = []
  const walk = (n: RecordNode): void => {
    if (n.tagId === SectionTag.CtrlHeader) {
      const p = n.payload
      const id = String.fromCharCode(p[3]!, p[2]!, p[1]!, p[0]!)
      if (OBJECTS.has(id)) out.push(Buffer.from(p).toString('hex'))
    }
    n.children.forEach(walk)
  }
  for (const p of c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p))) {
    const data = new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array)
    buildRecordTree(parseRecords(maybeInflate(data, compressed))).forEach(walk)
  }
  return out
}

/**
 * 한글 대화상자가 만들지 않는 값을 넣은 실험 파일(`experiments/object-props-out-of-dialog`)에서 코덱이
 * 개체 공통 속성을 바꿔 쓰는 것. 그리기 개체 CTRL_HEADER도 표처럼 모델(`placement`)로 쓰기 때문이다.
 * - bit 29(캡션 있음)는 캡션을 쓸 때만 켠다. 캡션 없이 켜진 파일은 한글이 거부한다.
 * - 세로 기준 3은 모델에서 문단이라 2로 쓴다. 한글도 문단 기준과 같은 자리에 그렸다.
 */
const PLACEMENT_REWRITES: [RegExp, (props: number) => number][] = [
  [/float-bit29-on\.hwp$/, (p) => (p & ~(1 << 29)) >>> 0],
  [/float-vrel-3\.hwp$/, (p) => ((p & ~(0b11 << 3)) | (2 << 3)) >>> 0],
]

/** CTRL_HEADER 페이로드(16진수)의 개체 공통 속성(오프셋 4)을 `rewrite`로 바꾼다. */
function rewritePlacement(file: string, hex: string): string {
  const rewrite = PLACEMENT_REWRITES.find(([re]) => re.test(file))?.[1]
  if (!rewrite) return hex
  const b = Buffer.from(hex, 'hex')
  b.writeUInt32LE(rewrite(b.readUInt32LE(4)), 4)
  return b.toString('hex')
}

describe('저장소 HWP 파일의 개체 CTRL_HEADER 왕복', () => {
  it.each(files.map((f) => [f.slice(root.length + 1), f]))('%s', (_, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    // 원본 비트 보존: 실험 파일 2개만 PLACEMENT_REWRITES대로 첫 gso 속성이 바뀐다.
    const expected = objectHeaders(bytes).map((h, i) => (i === 0 ? rewritePlacement(file, h) : h))
    expect(objectHeaders(serializeHwp(parseHwp(bytes)))).toEqual(expected)
  })
})

/** 첫 구역 최상위 문단에서 처음 나오는 표. */
function firstTable(path: string): Extract<Control, { type: 'table' }> {
  const doc = parseHwp(new Uint8Array(readFileSync(join(root, path))))
  for (const paragraph of doc.sections[0]!.paragraphs) {
    for (const item of paragraph.runs.flatMap((r) => r.items)) {
      if (item.type === 'table') return item
    }
  }
  throw new Error(`표가 없다: ${path}`)
}

/** 첫 `tbl ` CTRL_HEADER의 자식 중 TABLE 레코드 앞(캡션 LIST_HEADER와 캡션 문단 트리). */
function tableCaptionRecords(bytes: Uint8Array): string[] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  const data = new Uint8Array(CFB.find(c, '/BodyText/Section0')!.content as Uint8Array)
  const out: string[] = []
  const dump = (n: RecordNode, depth: number): void => {
    out.push(`${depth}:${n.tagId}:${Buffer.from(n.payload).toString('hex')}`)
    n.children.forEach((child) => dump(child, depth + 1))
  }
  const find = (n: RecordNode): boolean => {
    const p = n.payload
    if (n.tagId === SectionTag.CtrlHeader && String.fromCharCode(p[3]!, p[2]!, p[1]!, p[0]!) === 'tbl ') {
      for (const child of n.children) {
        if (child.tagId === SectionTag.Table) break
        dump(child, 0)
      }
      return true
    }
    return n.children.some(find)
  }
  buildRecordTree(parseRecords(maybeInflate(data, compressed))).some(find)
  return out
}

const text = (paragraphs: { runs: { items: { type: string; value?: string }[] }[] }[]): string =>
  paragraphs.flatMap((p) => p.runs.flatMap((r) => r.items.map((i) => (i.type === 'text' ? i.value : '')))).join('')

describe('개체 캡션', () => {
  const file = 'docs/experiments/object-common-props/table-caption-bottom.hwp'

  it('표 캡션을 읽는다 (한글 2024, 아래 캡션 "표 1 측정 결과")', () => {
    const { placement } = firstTable(file)
    expect(placement.caption).toMatchObject({
      side: CaptionSide.Bottom,
      fullSize: false,
      width: 8504,
      gap: 850,
      maxWidth: placement.width,
      verticalAlign: VerticalAlign.Top,
      unknownBits: 0,
      trailing: [0, 0, 0, 0, 0, 0, 0, 0],
    })
    expect(text(placement.caption!.paragraphs)).toContain('측정 결과')
  })

  it('표 캡션 LIST_HEADER와 문단을 원본과 같은 바이트로 다시 쓴다', () => {
    const bytes = new Uint8Array(readFileSync(join(root, file)))
    const records = tableCaptionRecords(bytes)
    expect(records.length).toBeGreaterThan(0)
    expect(tableCaptionRecords(serializeHwp(parseHwp(bytes)))).toEqual(records)
  })

  it('그리기 개체 캡션을 읽는다 (한글 2024 사각형, 아래 캡션)', () => {
    const doc = parseHwp(new Uint8Array(readFileSync(join(root, 'docs/experiments/object-common-props/rect-caption-bottom.hwp'))))
    const rect = doc.sections[0]!.paragraphs.flatMap((p) => p.runs.flatMap((r) => r.items)).find((i) => i.type === 'rectangle')
    const placement = rect?.type === 'rectangle' ? rect.placement : undefined
    expect(placement?.caption).toMatchObject({
      side: CaptionSide.Bottom,
      fullSize: false,
      width: 8504,
      gap: 850,
      // 폭 기준이 문단이라 placement.width는 백분율×100(4539)이다. 캡션 최대 길이는 실제 폭이다.
      maxWidth: 19300,
      verticalAlign: VerticalAlign.Top,
      unknownBits: 0,
      trailing: [0, 0, 0, 0, 0, 0, 0, 0],
    })
    expect(placement?.caption?.paragraphs).toHaveLength(1)
  })

  it('그림 캡션을 SHAPE_COMPONENT 앞에 쓰고 다시 읽는다', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const doc = new DocumentBuilder().image(png, { width: 1000, height: 1000, caption: '그림 캡션' }).build()
    const bytes = serializeHwp(doc)
    const props = Number.parseInt(objectHeaders(bytes)[0]!.slice(8, 16).match(/../g)!.reverse().join(''), 16)
    expect((props >>> 29) & 1).toBe(1)
    const picture = parseHwp(bytes).sections[0]!.paragraphs.flatMap((p) => p.runs.flatMap((r) => r.items)).find((i) => i.type === 'picture')
    expect(picture?.type === 'picture' && text(picture.placement.caption!.paragraphs)).toBe('그림 캡션')
  })

  it('캡션이 있는 표만 bit 29를 켜고 TABLE 앞에 캡션을 쓴다', () => {
    const withCaption = serializeHwp(new DocumentBuilder().table([['셀']], { caption: '표 캡션' }).build())
    const without = serializeHwp(new DocumentBuilder().table([['셀']]).build())
    const props = (bytes: Uint8Array) => Number.parseInt(objectHeaders(bytes)[0]!.slice(8, 16).match(/../g)!.reverse().join(''), 16)
    expect((props(withCaption) >>> 29) & 1).toBe(1)
    expect((props(without) >>> 29) & 1).toBe(0)
    const table = parseHwp(withCaption).sections[0]!.paragraphs[0]!.runs[0]!.items[0]
    expect(table?.type === 'table' && text(table.placement.caption!.paragraphs)).toBe('표 캡션')
  })
})

describe('캡션 리스트 속성 (표 65, experiments/caption-list-properties)', () => {
  const dir = 'docs/experiments/caption-list-properties'
  const caption = (name: string) => firstTable(`${dir}/${name}`).placement.caption!

  it.each([
    ['table-textdir-1.hwp', { textDirection: TextDirection.Vertical }],
    ['table-textdir-2.hwp', { textDirection: TextDirection.VerticalAll }],
    ['table-linewrap-1.hwp', { lineWrap: ListLineWrap.Squeeze }],
    ['table-linewrap-2.hwp', { lineWrap: ListLineWrap.Keep }],
    ['table-valign-1.hwp', { verticalAlign: VerticalAlign.Center }],
    ['table-valign-2.hwp', { verticalAlign: VerticalAlign.Bottom }],
    ['table-bit24.hwp', { listUnknownBits: 1 << 24 }],
  ])('%s의 리스트 속성을 필드로 읽는다', (name, fields) => {
    expect(caption(name)).toMatchObject(fields)
  })

  it('비트를 바꾼 캡션 LIST_HEADER와 문단을 원본과 같은 바이트로 다시 쓴다', () => {
    for (const name of readdirSync(join(root, dir)).filter((f) => f.startsWith('table-') && f.endsWith('.hwp'))) {
      const bytes = new Uint8Array(readFileSync(join(root, dir, name)))
      expect(tableCaptionRecords(serializeHwp(parseHwp(bytes))), name).toEqual(tableCaptionRecords(bytes))
    }
  })

  it('새 캡션은 세로 정렬 위(0)로, 고친 세로 정렬은 bit 5~6으로 쓴다', () => {
    const listProps = (bytes: Uint8Array) => tableCaptionRecords(bytes)[0]!.split(':')[2]!.slice(8, 16)
    const doc = new DocumentBuilder().table([['셀']], { caption: '캡션' }).build()
    expect(listProps(serializeHwp(doc))).toBe('00000000')
    const table = doc.sections[0]!.paragraphs[0]!.runs[0]!.items[0]
    if (table?.type !== 'table') throw new Error('표가 없다')
    table.placement.caption!.verticalAlign = VerticalAlign.Center
    expect(listProps(serializeHwp(doc))).toBe('20000000')
    table.placement.caption!.verticalAlign = VerticalAlign.Bottom
    expect(listProps(serializeHwp(doc))).toBe('40000000')
  })
})

describe('캡션 8방향 (experiments/caption-positions, E55)', () => {
  const dir = 'docs/experiments/caption-positions'
  const read = (name: string) => new Uint8Array(readFileSync(join(root, dir, name)))
  const section = (file: Uint8Array): string => {
    const c = CFB.read(file, { type: 'buffer' })
    const compressed = ((CFB.find(c, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
    return Buffer.from(maybeInflate(new Uint8Array(CFB.find(c, '/BodyText/Section0')!.content as Uint8Array), compressed)).toString('hex')
  }
  const captions = (bytes: Uint8Array) =>
    parseHwp(bytes)
      .sections[0]!.paragraphs.flatMap((p) => p.runs.flatMap((r) => r.items))
      .flatMap((i) => ('placement' in i && i.placement?.caption ? [i.placement.caption] : []))
  /** 캡션 LIST_HEADER의 리스트 속성·캡션 속성·폭·간격·텍스트 최대 길이. */
  const fields = (bytes: Uint8Array) =>
    tableCaptionRecords(bytes)
      .filter((r) => r.startsWith(`0:${SectionTag.ListHeader}:`))
      .map((r) => {
        const v = Buffer.from(r.split(':')[2]!, 'hex')
        return [v.readUInt32LE(4), v.readUInt32LE(8), v.readUInt32LE(12), v.readInt16LE(16), v.readUInt32LE(18)]
      })

  it('대화상자의 8방향을 4방향과 세로 정렬로 읽는다', () => {
    const got = captions(read('table-caption-positions.hwp')).map((c) => [c.side, c.verticalAlign, c.lineWrap, c.fullSize, c.maxWidth])
    const { Left, Right, Top, Bottom } = CaptionSide
    const { Top: T, Center: C, Bottom: B } = VerticalAlign
    expect(got).toEqual([
      [Left, T, undefined, false, 8504], // 왼쪽 위
      [Left, C, undefined, false, 8504], // 왼쪽 가운데
      [Left, B, undefined, false, 8504], // 왼쪽 아래
      [Top, T, undefined, false, 41954], // 위
      [Bottom, T, undefined, false, 41954], // 아래
      [Right, T, undefined, false, 8504], // 오른쪽 위
      [Right, C, undefined, false, 8504], // 오른쪽 가운데
      [Right, B, undefined, false, 8504], // 오른쪽 아래
      [Bottom, T, ListLineWrap.Squeeze, false, 41954], // 아래 + 한 줄로 입력
      [Bottom, T, undefined, true, 42520], // 아래 + 여백 부분까지 너비 확대
    ])
  })

  it('그리기 개체 캡션도 같은 비트다', () => {
    expect(captions(read('rect-caption-right-middle-oneline.hwp'))).toMatchObject([
      { side: CaptionSide.Right, verticalAlign: VerticalAlign.Center, lineWrap: ListLineWrap.Squeeze, width: 8504, gap: 850, maxWidth: 8504 },
    ])
  })

  it.each(['table-caption-positions.hwp', 'rect-caption-right-middle-oneline.hwp'])('%s의 구역 스트림을 원본과 같은 바이트로 다시 쓴다', (name) => {
    const bytes = read(name)
    expect(section(serializeHwp(parseHwp(bytes)))).toBe(section(bytes))
  })

  it.each([
    ['left-top', 0x00, 0],
    ['left-center', 0x20, 0],
    ['left-bottom', 0x40, 0],
    ['top', 0x00, 2],
    ['bottom', 0x00, 3],
    ['right-top', 0x00, 1],
    ['right-center', 0x20, 1],
    ['right-bottom', 0x40, 1],
  ] as const)('편집 API의 %s 캡션을 한글처럼 쓴다', (position, list, captionProps) => {
    const doc = new DocumentBuilder().table([['셀']], { caption: { text: '캡션', position } }).build()
    const table = doc.sections[0]!.paragraphs[0]!.runs[0]!.items[0]
    if (table?.type !== 'table') throw new Error('표가 없다')
    const side = position.startsWith('left') || position.startsWith('right')
    // 한글 기본값: 크기 30mm(8504), 간격 3mm(850). 텍스트 최대 길이는 왼쪽·오른쪽이면 캡션 폭, 위·아래면 표 폭.
    expect(fields(serializeHwp(doc))).toEqual([[list, captionProps, 8504, 850, side ? 8504 : table.placement.width]])
  })

  it('한 줄로 입력은 bit 3, 여백 부분까지 너비 확대는 bit 2와 바깥 여백을 더한 최대 길이로 쓴다', () => {
    const build = (caption: Parameters<DocumentBuilder['table']>[1]) => {
      const doc = new DocumentBuilder().table([['셀']], caption).build()
      const table = doc.sections[0]!.paragraphs[0]!.runs[0]!.items[0]
      if (table?.type !== 'table') throw new Error('표가 없다')
      return { doc, placement: table.placement }
    }
    expect(fields(serializeHwp(build({ caption: { text: '캡션', singleLine: true } }).doc))[0]!.slice(0, 2)).toEqual([0x08, 3])
    const { doc, placement } = build({ caption: { text: '캡션', fullWidth: true } })
    placement.marginLeft = 283
    placement.marginRight = 283
    expect(fields(serializeHwp(doc))[0]).toEqual([0, 7, 8504, 850, placement.width + 566])
  })

  it('여백 부분까지 너비 확대는 왼쪽·오른쪽 캡션에서 받지 않는다', () => {
    expect(() => new DocumentBuilder().table([['셀']], { caption: { text: '캡션', position: 'left-center', fullWidth: true } })).toThrow(RangeError)
  })
})

describe('개체 공통 속성 (experiments/object-common-props, 한글 2024)', () => {
  const dir = 'docs/experiments/object-common-props'

  it('바깥 여백을 왼쪽, 오른쪽, 위쪽, 아래쪽 순서로 읽는다', () => {
    // 대화상자 값: 왼쪽 1.5, 오른쪽 2.5, 위쪽 3.5, 아래쪽 4.5mm
    const { placement } = firstTable(`${dir}/table-wrap-square.hwp`)
    const mm = (v: number | undefined) => Math.round(((v ?? 0) * 25.4) / 7200 * 10) / 10
    expect([placement.marginLeft, placement.marginRight, placement.marginTop, placement.marginBottom].map(mm)).toEqual([
      1.5, 2.5, 3.5, 4.5,
    ])
  })

  it('속성 비트: 크기 고정, 번호 종류, 개체 보호, 본문과의 배치', () => {
    const { placement } = firstTable(`${dir}/table-wrap-square.hwp`)
    expect(placement).toMatchObject({
      fixedSize: true,
      numberingKind: NumberingKind.Figure,
      locked: true,
      textWrap: TextWrap.Square,
      vertRelTo: RelativeTo.Page,
      horzRelTo: RelativeTo.Page,
      unknownBits: 0,
    })
  })

  it('자리 차지와 글 뒤로를 구분한다', () => {
    expect(firstTable(`${dir}/table-topbottom-para.hwp`).placement.textWrap).toBe(TextWrap.TopAndBottom)
    expect(firstTable(`${dir}/table-behind-para.hwp`).placement.textWrap).toBe(TextWrap.BehindText)
  })

  it('쪽나눔 방지("개체와 조판 부호를 항상 같은 쪽에 놓기")와 설명문 뒤 2바이트', () => {
    const { placement } = firstTable(`${dir}/table-topbottom-para.hwp`)
    expect(placement.keepWithAnchor).toBe(true)
    expect(placement.description).toBe('')
    expect(placement.trailing).toEqual([0, 0])
    expect(firstTable(`${dir}/table-wrap-square.hwp`).placement.keepWithAnchor).toBe(false)
  })
})
