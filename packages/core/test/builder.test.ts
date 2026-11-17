import { describe, expect, it } from 'vitest'
import {
  parseColor,
  Align,
  DocumentBuilder,
  LineSpacingKind,
  createDocument,
  documentText,
  imageSize,
  paragraphText,
  pt,
  replaceText,
  sniffImageFormat,
  statistics,
  tableToArray,
  tables,
  walkParagraphs,
} from '../src/index.js'

describe('DocumentBuilder', () => {
  it('문단 하나로 된 문서를 만든다', () => {
    const doc = new DocumentBuilder().paragraph('안녕하세요').build()
    expect(doc.sections).toHaveLength(1)
    expect(documentText(doc)).toBe('안녕하세요')
  })

  it('글자 모양이 같은 인접 런을 합친다', () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.text('가').text('나').text('다'))
      .build()
    const paragraph = doc.sections[0]!.paragraphs[0]!
    expect(paragraph.runs).toHaveLength(1)
    expect(paragraph.runs[0]!.items).toHaveLength(1)
    expect(paragraphText(paragraph)).toBe('가나다')
  })

  it('스타일이 바뀌면 런을 나누고 모양마다 한 번만 인터닝한다', () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.text('보통 ').bold('굵게').text(' 다시 보통').bold(' 또 굵게'))
      .build()

    const runs = doc.sections[0]!.paragraphs[0]!.runs
    expect(runs).toHaveLength(4)
    // 진하게 run 둘이 같은 인터닝된 모양으로 해석돼야 한다.
    expect(runs[1]!.charShapeId).toBe(runs[3]!.charShapeId)
    expect(runs[0]!.charShapeId).toBe(runs[2]!.charShapeId)
    expect(doc.charShapes).toHaveLength(2)
    expect(doc.charShapes[runs[1]!.charShapeId]!.bold).toBe(true)
  })

  it('문단 스타일을 적용한다', () => {
    const doc = new DocumentBuilder()
      .paragraph('가운데', { align: 'center', lineHeight: 200, spaceBefore: 10 })
      .build()
    const shape = doc.paraShapes[doc.sections[0]!.paragraphs[0]!.paraShapeId]!
    expect(shape.align).toBe(Align.Center)
    expect(shape.lineSpacing).toEqual({ kind: LineSpacingKind.Percent, value: 200 })
    expect(shape.marginTop).toBe(2000)
  })

  it('여백과 문단 간격을 HWPUNIT의 2배로 저장한다 (정오표 E18)', () => {
    const doc = new DocumentBuilder()
      .paragraph('여백', { marginLeft: '25pt', marginRight: '-10pt', spaceAfter: '0.1pt' })
      .build()
    const shape = doc.paraShapes[doc.sections[0]!.paragraphs[0]!.paraShapeId]!
    expect(shape.marginLeft).toBe(5000)
    expect(shape.marginRight).toBe(-2000)
    expect(shape.marginBottom).toBe(20)
  })

  it('고정 줄 간격을 HWPUNIT의 2배로 저장한다 (정오표 E20)', () => {
    const doc = new DocumentBuilder().paragraph('고정', { lineHeightFixed: '16pt' }).build()
    const shape = doc.paraShapes[doc.sections[0]!.paragraphs[0]!.paraShapeId]!
    expect(shape.lineSpacing).toEqual({ kind: LineSpacingKind.Fixed, value: 3200 })
  })

  it('이름·16진수·rgb()로 색을 해석한다', () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => {
        p.text('a', { color: 'red' })
        p.text('b', { color: '#00ff00' })
        p.text('c', { color: 'rgb(0, 0, 255)' })
      })
      .build()
    const runs = doc.sections[0]!.paragraphs[0]!.runs
    const colors = runs.map((r) => doc.charShapes[r.charShapeId]!.textColor)
    expect(colors).toEqual([0xff0000, 0x00ff00, 0x0000ff].map(parseColor))
  })

  it('글꼴을 필요할 때 등록하고 재사용한다', () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.text('a', { font: '나눔고딕' }).text('b', { font: '나눔고딕' }))
      .build()
    for (const fonts of doc.fonts) expect(fonts.filter((f) => f.name === '나눔고딕')).toHaveLength(1)
  })

  it('개요 스타일을 쓰는 제목을 만든다', () => {
    const doc = new DocumentBuilder().heading(1, '1. 개요').heading(2, '1.1 배경').build()
    const [first, second] = doc.sections[0]!.paragraphs
    expect(doc.styles[first!.styleId]!.name).toBe('개요 1')
    expect(doc.styles[second!.styleId]!.name).toBe('개요 2')
    expect(doc.charShapes[first!.runs[0]!.charShapeId]!.bold).toBe(true)
    expect(doc.charShapes[first!.runs[0]!.charShapeId]!.height).toBeGreaterThan(
      doc.charShapes[second!.runs[0]!.charShapeId]!.height,
    )
  })

  it('2차원 배열로 표를 만든다', () => {
    const doc = new DocumentBuilder()
      .table(
        [
          ['이름', '부서'],
          ['홍길동', '개발'],
        ],
        { header: true },
      )
      .build()

    const [table] = tables(doc)
    expect(table).toBeDefined()
    expect(tableToArray(table!)).toEqual([
      ['이름', '부서'],
      ['홍길동', '개발'],
    ])
    expect(table!.rows[0]!.cells[0]!.header).toBe(true)
    // 제목 셀은 진하다.
    const headerShape = table!.rows[0]!.cells[0]!.paragraphs[0]!.runs[0]!.charShapeId
    expect(doc.charShapes[headerShape]!.bold).toBe(true)
  })

  it('셀 병합을 지원한다', () => {
    const doc = new DocumentBuilder()
      .table({ rows: 3, cols: 3 }, {}, (t) => {
        t.cell(0, 0, '머리글').merge(0, 0, 1, 3)
        t.cell(1, 0, 'a').cell(1, 1, 'b').cell(1, 2, 'c')
      })
      .build()

    const [table] = tables(doc)
    expect(table!.rows[0]!.cells).toHaveLength(1)
    expect(table!.rows[0]!.cells[0]!.colSpan).toBe(3)
    expect(table!.rows[1]!.cells).toHaveLength(3)
  })

  it('병합되어 사라진 셀을 가리키면 도움이 되는 오류를 알린다', () => {
    expect(() =>
      new DocumentBuilder().table({ rows: 2, cols: 2 }, {}, (t) => {
        t.merge(0, 0, 1, 2)
        t.cell(0, 1, 'gone')
      }),
    ).toThrow(/covered by a merge/)
  })

  it('이미지를 넣고 크기를 구한다', () => {
    const png = makePng(200, 100)
    const doc = new DocumentBuilder().image(png, {}).build()
    expect(doc.binData).toHaveLength(1)
    expect(doc.binData[0]!.extension).toBe('png')
    const picture = doc.sections[0]!.paragraphs[0]!.runs[0]!.items[0]!
    expect(picture.type).toBe('picture')
    if (picture.type === 'picture') {
      // 96dpi에서 200x100 px는 15000x7500 HWPUNIT이고 종횡비가 유지된다.
      expect(picture.placement.width / picture.placement.height).toBeCloseTo(2, 5)
    }
  })

  it('하이퍼링크를 필드 쌍으로 만든다', () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.text('보기: ').link('한컴', 'https://hancom.com'))
      .build()
    const items = doc.sections[0]!.paragraphs[0]!.runs.flatMap((r) => r.items)
    const begin = items.find((i) => i.type === 'fieldBegin')
    const end = items.find((i) => i.type === 'fieldEnd')
    expect(begin).toBeDefined()
    expect(end).toBeDefined()
    if (begin?.type === 'fieldBegin' && end?.type === 'fieldEnd') {
      expect(begin.command).toContain('https://hancom.com')
      expect(begin.id).toBe(end.id)
    }
  })

  it('독립된 쪽 설정으로 새 구역을 시작한다', () => {
    const doc = new DocumentBuilder()
      .page({ paper: 'A4' })
      .paragraph('세로')
      .section({ paper: 'A4', landscape: true })
      .paragraph('가로')
      .build()

    expect(doc.sections).toHaveLength(2)
    expect(doc.sections[0]!.pageDef.landscape).toBe(false)
    expect(doc.sections[1]!.pageDef.landscape).toBe(true)
  })

  it('빈 구역을 만들지 않는다', () => {
    const doc = new DocumentBuilder().build()
    expect(doc.sections[0]!.paragraphs.length).toBeGreaterThan(0)
  })
})

describe('텍스트 추출', () => {
  it('기본으로 표 내용을 포함한다', () => {
    const doc = new DocumentBuilder()
      .paragraph('앞')
      .table([['a', 'b']])
      .paragraph('뒤')
      .build()
    expect(documentText(doc)).toBe('앞\n\na\tb\n뒤')
  })

  it('표를 건너뛸 수 있다', () => {
    const doc = new DocumentBuilder().paragraph('앞').table([['a', 'b']]).build()
    expect(documentText(doc, { includeTables: false })).toBe('앞\n')
  })

  it('표 셀 안에 중첩된 문단을 순회한다', () => {
    const doc = new DocumentBuilder().table([['셀 안']]).build()
    const found = [...walkParagraphs(doc)].map((l) => paragraphText(l.paragraph))
    expect(found).toContain('셀 안')
  })
})

describe('replaceText', () => {
  it('일반 문자열을 바꾼다', () => {
    const doc = new DocumentBuilder().paragraph('안녕 세상, 안녕').build()
    expect(replaceText(doc, '안녕', '반가워').count).toBe(2)
    expect(documentText(doc)).toBe('반가워 세상, 반가워')
  })

  it('문자열 패턴을 글자 그대로 취급한다', () => {
    const doc = new DocumentBuilder().paragraph('a.c and abc').build()
    expect(replaceText(doc, 'a.c', 'X').count).toBe(1)
    expect(documentText(doc)).toBe('X and abc')
  })

  it('정규식과 캡처 그룹을 지원한다', () => {
    const doc = new DocumentBuilder().paragraph('2024-01-02').build()
    replaceText(doc, /(\d{4})-(\d{2})-(\d{2})/, '$1년 $2월 $3일')
    expect(documentText(doc)).toBe('2024년 01월 02일')
  })

  it('바꾸기 함수를 지원한다', () => {
    const doc = new DocumentBuilder().paragraph('a1 b2').build()
    replaceText(doc, /[a-z](\d)/g, (_m, digit) => `[${digit}]`)
    expect(documentText(doc)).toBe('[1] [2]')
  })

  it('런 경계를 넘어 바꾸고 첫 런의 서식을 유지한다', () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.text('안녕하').bold('세요'))
      .build()
    expect(replaceText(doc, '안녕하세요', '반갑습니다').count).toBe(1)
    expect(documentText(doc)).toBe('반갑습니다')
  })

  it('표 셀 안에서도 바꾼다', () => {
    const doc = new DocumentBuilder().table([['이전 값']]).build()
    expect(replaceText(doc, '이전', '이후').count).toBe(1)
    expect(tableToArray(tables(doc)[0]!)).toEqual([['이후 값']])
  })

  it('일치하는 것이 없으면 0을 알린다', () => {
    const doc = new DocumentBuilder().paragraph('가나다').build()
    expect(replaceText(doc, '없음', 'x').count).toBe(0)
  })
})

describe('statistics', () => {
  it('글자·단어·문단 수를 센다', () => {
    const doc = new DocumentBuilder()
      .paragraph('hello world')
      .paragraph('두 번째 문단입니다')
      .table([['a']])
      .build()
    const stats = statistics(doc)
    expect(stats.paragraphs).toBeGreaterThanOrEqual(3)
    expect(stats.words).toBeGreaterThanOrEqual(2)
    expect(stats.charactersNoSpaces).toBeLessThan(stats.characters)
    expect(stats.tables).toBe(1)
  })
})

describe('이미지 도우미', () => {
  it('흔한 형식을 판별한다', () => {
    expect(sniffImageFormat(makePng(1, 1))).toBe('png')
    expect(sniffImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(sniffImageFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('gif')
    expect(sniffImageFormat(new Uint8Array([1, 2, 3]))).toBeUndefined()
  })

  it('PNG 크기를 읽는다', () => {
    expect(imageSize(makePng(640, 480))).toEqual({ width: 640, height: 480 })
  })

  it('GIF 크기를 읽는다', () => {
    const gif = new Uint8Array(10)
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    new DataView(gif.buffer).setUint16(6, 320, true)
    new DataView(gif.buffer).setUint16(8, 240, true)
    expect(imageSize(gif)).toEqual({ width: 320, height: 240 })
  })
})

describe('createDocument', () => {
  it('코덱이 인덱스 0의 존재를 가정할 수 있도록 모든 리소스 표를 채운다', () => {
    const doc = createDocument()
    for (const fonts of doc.fonts) expect(fonts.length).toBeGreaterThan(0)
    expect(doc.charShapes.length).toBeGreaterThan(0)
    expect(doc.paraShapes.length).toBeGreaterThan(0)
    expect(doc.borderFills.length).toBeGreaterThan(0)
    expect(doc.styles[0]!.name).toBe('바탕글')
    expect(doc.tabDefs.length).toBeGreaterThan(0)
  })
})

/** 크기 판별에 충분한 최소한이지만 구조적으로 유효한 PNG 헤더. */
function makePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0, 0, 0, 13], 8)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width, false)
  view.setUint32(20, height, false)
  return bytes
}
