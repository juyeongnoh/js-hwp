import { describe, expect, it } from 'vitest'
import {
  parseColor,
  Align,
  DocumentBuilder,
  History,
  charShapeAt,
  clampPosition,
  comparePositions,
  deleteRange,
  documentText,
  formatParagraphs,
  formatText,
  insertItem,
  insertText,
  mergeWithPrevious,
  paragraphLength,
  paragraphText,
  position,
  rangeHasFormat,
  snapshot,
  splitParagraph,
  textInRange,
} from '../src/index.js'

const doc1 = (text = '안녕하세요') => new DocumentBuilder().paragraph(text).build()

describe('위치', () => {
  it('텍스트가 아닌 항목을 각각 한 글자로 센다', () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.text('ab').tab().text('cd').lineBreak())
      .build()
    // 'ab' + 탭 + 'cd' + 줄바꿈 = 2 + 1 + 2 + 1
    expect(paragraphLength(doc.sections[0]!.paragraphs[0]!)).toBe(6)
  })

  it('구역·문단·오프셋 순으로 위치를 비교한다', () => {
    expect(comparePositions(position(0, 0, 0), position(0, 0, 1))).toBeLessThan(0)
    expect(comparePositions(position(0, 1, 0), position(0, 0, 9))).toBeGreaterThan(0)
    expect(comparePositions(position(1, 0, 0), position(0, 9, 9))).toBeGreaterThan(0)
    expect(comparePositions(position(0, 2, 3), position(0, 2, 3))).toBe(0)
  })

  it('위치를 문서 범위 안으로 제한한다', () => {
    const doc = doc1('abc')
    expect(clampPosition(doc, position(9, 9, 9))).toEqual(position(0, 0, 3))
    expect(clampPosition(doc, position(-1, -1, -1))).toEqual(position(0, 0, 0))
  })
})

describe('insertText', () => {
  it('처음·중간·끝에 삽입한다', () => {
    const doc = doc1('BD')
    insertText(doc, position(0, 0, 0), 'A')
    insertText(doc, position(0, 0, 2), 'C')
    insertText(doc, position(0, 0, 4), 'E')
    expect(documentText(doc)).toBe('ABCDE')
  })

  it('삽입한 텍스트 바로 뒤의 위치를 반환한다', () => {
    const doc = doc1('가나')
    expect(insertText(doc, position(0, 0, 1), '다라')).toEqual(position(0, 0, 3))
  })

  it('왼쪽 글자의 서식을 물려받는다', () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.text('평문').bold('굵게'))
      .build()
    const boldShape = doc.sections[0]!.paragraphs[0]!.runs[1]!.charShapeId
    // 오프셋 4는 '굵' 바로 뒤로, 진하게 런 안이다.
    insertText(doc, position(0, 0, 4), 'X')
    const runs = doc.sections[0]!.paragraphs[0]!.runs
    const carrying = runs.find((r) => r.items.some((i) => i.type === 'text' && i.value.includes('X')))
    expect(carrying!.charShapeId).toBe(boldShape)
  })

  it('런을 쪼개지 않고 인접한 런에 합친다', () => {
    const doc = doc1('ab')
    insertText(doc, position(0, 0, 1), 'X')
    expect(doc.sections[0]!.paragraphs[0]!.runs).toHaveLength(1)
    expect(doc.sections[0]!.paragraphs[0]!.runs[0]!.items).toHaveLength(1)
  })

  it('빈 문단에 삽입한다', () => {
    const doc = new DocumentBuilder().paragraph('').build()
    insertText(doc, position(0, 0, 0), '처음')
    expect(documentText(doc)).toBe('처음')
  })

  it('빈 텍스트면 아무것도 하지 않는다', () => {
    const doc = doc1('abc')
    expect(insertText(doc, position(0, 0, 1), '')).toEqual(position(0, 0, 1))
    expect(documentText(doc)).toBe('abc')
  })
})

describe('insertItem', () => {
  it('탭을 삽입하고 한 글자만큼 나아간다', () => {
    const doc = doc1('ab')
    expect(insertItem(doc, position(0, 0, 1), { type: 'tab' })).toEqual(position(0, 0, 2))
    expect(paragraphLength(doc.sections[0]!.paragraphs[0]!)).toBe(3)
  })
})

describe('deleteRange', () => {
  it('문단 안에서 삭제한다', () => {
    const doc = doc1('abcdef')
    expect(deleteRange(doc, { start: position(0, 0, 1), end: position(0, 0, 4) })).toEqual(position(0, 0, 1))
    expect(documentText(doc)).toBe('aef')
  })

  it('접힌 범위면 아무것도 하지 않는다', () => {
    const doc = doc1('abc')
    deleteRange(doc, { start: position(0, 0, 1), end: position(0, 0, 1) })
    expect(documentText(doc)).toBe('abc')
  })

  it('거꾸로 된 범위를 정규화한다', () => {
    const doc = doc1('abcdef')
    deleteRange(doc, { start: position(0, 0, 4), end: position(0, 0, 1) })
    expect(documentText(doc)).toBe('aef')
  })

  it('여러 문단에 걸쳐 삭제하고 남은 부분을 잇는다', () => {
    const doc = new DocumentBuilder().paragraph('첫째').paragraph('둘째').paragraph('셋째').build()
    deleteRange(doc, { start: position(0, 0, 1), end: position(0, 2, 1) })
    expect(doc.sections[0]!.paragraphs).toHaveLength(1)
    expect(documentText(doc)).toBe('첫째')
  })

  it('중간의 문단 전체를 삭제한다', () => {
    const doc = new DocumentBuilder().paragraph('a').paragraph('gone').paragraph('b').build()
    deleteRange(doc, { start: position(0, 0, 1), end: position(0, 2, 0) })
    expect(documentText(doc)).toBe('ab')
  })

  it('남은 부분의 서식을 보존한다', () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.text('평문').bold('굵게'))
      .build()
    deleteRange(doc, { start: position(0, 0, 0), end: position(0, 0, 2) })
    const runs = doc.sections[0]!.paragraphs[0]!.runs
    expect(runs).toHaveLength(1)
    expect(doc.charShapes[runs[0]!.charShapeId]!.bold).toBe(true)
  })
})

describe('splitParagraph', () => {
  it('중간에서 나눈다', () => {
    const doc = doc1('안녕하세요')
    expect(splitParagraph(doc, position(0, 0, 2))).toEqual(position(0, 1, 0))
    const paragraphs = doc.sections[0]!.paragraphs
    expect(paragraphs).toHaveLength(2)
    expect(paragraphText(paragraphs[0]!)).toBe('안녕')
    expect(paragraphText(paragraphs[1]!)).toBe('하세요')
  })

  it('끝에서 나누면 빈 문단이 남는다', () => {
    const doc = doc1('abc')
    splitParagraph(doc, position(0, 0, 3))
    expect(paragraphText(doc.sections[0]!.paragraphs[1]!)).toBe('')
  })

  it('스타일의 다음 스타일 연결을 따른다', () => {
    const doc = new DocumentBuilder().heading(1, '제목').build()
    // '개요 1'의 nextStyleId는 0('바탕글')이라 Enter를 누르면 본문으로 돌아간다.
    splitParagraph(doc, position(0, 0, 2))
    expect(doc.styles[doc.sections[0]!.paragraphs[1]!.styleId]!.name).toBe('바탕글')
  })
})

describe('mergeWithPrevious', () => {
  it('문단을 위 문단에 합친다', () => {
    const doc = new DocumentBuilder().paragraph('안녕').paragraph('하세요').build()
    expect(mergeWithPrevious(doc, position(0, 1, 0))).toEqual(position(0, 0, 2))
    expect(doc.sections[0]!.paragraphs).toHaveLength(1)
    expect(documentText(doc)).toBe('안녕하세요')
  })

  it('첫 문단에서는 아무것도 하지 않는다', () => {
    const doc = doc1('abc')
    expect(mergeWithPrevious(doc, position(0, 0, 0))).toEqual(position(0, 0, 0))
    expect(doc.sections[0]!.paragraphs).toHaveLength(1)
  })
})

describe('textInRange', () => {
  it('문단의 일부를 추출한다', () => {
    const doc = doc1('안녕하세요')
    expect(textInRange(doc, { start: position(0, 0, 1), end: position(0, 0, 4) })).toBe('녕하세')
  })

  it('문단을 줄바꿈으로 잇는다', () => {
    const doc = new DocumentBuilder().paragraph('첫째').paragraph('둘째').build()
    expect(textInRange(doc, { start: position(0, 0, 1), end: position(0, 1, 1) })).toBe('째\n둘')
  })
})

describe('formatText', () => {
  it('일부 범위를 진하게 하고 런을 나눈다', () => {
    const doc = doc1('안녕하세요')
    formatText(doc, { start: position(0, 0, 0), end: position(0, 0, 2) }, { bold: true })

    const runs = doc.sections[0]!.paragraphs[0]!.runs
    expect(runs).toHaveLength(2)
    expect(doc.charShapes[runs[0]!.charShapeId]!.bold).toBe(true)
    expect(doc.charShapes[runs[1]!.charShapeId]!.bold).toBeFalsy()
    expect(documentText(doc)).toBe('안녕하세요')
  })

  it('중간 부분에 서식을 적용해 런 세 개를 만든다', () => {
    const doc = doc1('abcdef')
    formatText(doc, { start: position(0, 0, 2), end: position(0, 0, 4) }, { color: 'red' })
    const runs = doc.sections[0]!.paragraphs[0]!.runs
    expect(runs).toHaveLength(3)
    expect(doc.charShapes[runs[1]!.charShapeId]!.textColor).toEqual(parseColor(0xff0000))
    expect(documentText(doc)).toBe('abcdef')
  })

  it('여러 문단에 걸쳐 서식을 적용한다', () => {
    const doc = new DocumentBuilder().paragraph('첫째').paragraph('둘째').build()
    formatText(doc, { start: position(0, 0, 1), end: position(0, 1, 1) }, { italic: true })
    expect(doc.charShapes[doc.sections[0]!.paragraphs[1]!.runs[0]!.charShapeId]!.italic).toBe(true)
  })

  it('같은 서식에는 인터닝된 모양 하나를 재사용한다', () => {
    const doc = new DocumentBuilder().paragraph('ab').paragraph('cd').build()
    const before = doc.charShapes.length
    formatText(doc, { start: position(0, 0, 0), end: position(0, 0, 2) }, { bold: true })
    formatText(doc, { start: position(0, 1, 0), end: position(0, 1, 2) }, { bold: true })
    expect(doc.charShapes.length).toBe(before + 1)
  })

  it('접힌 범위면 문서를 바꾸지 않는다', () => {
    const doc = doc1('abc')
    const before = doc.charShapes.length
    formatText(doc, { start: position(0, 0, 1), end: position(0, 0, 1) }, { bold: true })
    expect(doc.charShapes.length).toBe(before)
  })
})

describe('rangeHasFormat', () => {
  it('모든 글자가 일치할 때만 참이다', () => {
    const doc = doc1('안녕하세요')
    const all = { start: position(0, 0, 0), end: position(0, 0, 5) }
    expect(rangeHasFormat(doc, all, (s) => s.bold === true)).toBe(false)

    formatText(doc, { start: position(0, 0, 0), end: position(0, 0, 2) }, { bold: true })
    expect(rangeHasFormat(doc, all, (s) => s.bold === true)).toBe(false)
    expect(
      rangeHasFormat(doc, { start: position(0, 0, 0), end: position(0, 0, 2) }, (s) => s.bold === true),
    ).toBe(true)
  })
})

describe('formatParagraphs', () => {
  it('범위에 걸친 모든 문단에 정렬을 적용한다', () => {
    const doc = new DocumentBuilder().paragraph('a').paragraph('b').paragraph('c').build()
    formatParagraphs(doc, { start: position(0, 0, 0), end: position(0, 1, 1) }, { align: 'center' })
    const shapes = doc.sections[0]!.paragraphs.map((p) => doc.paraShapes[p.paraShapeId]!.align)
    expect(shapes[0]).toBe(Align.Center)
    expect(shapes[1]).toBe(Align.Center)
    expect(shapes[2]).not.toBe(Align.Center)
  })
})

describe('charShapeAt', () => {
  it('캐럿 왼쪽의 서식을 알려 준다', () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.text('평문').bold('굵게'))
      .build()
    expect(charShapeAt(doc, position(0, 0, 2))?.bold).toBeFalsy()
    expect(charShapeAt(doc, position(0, 0, 4))?.bold).toBe(true)
  })
})

describe('History', () => {
  it('실행 취소와 다시 실행을 한다', () => {
    let doc = doc1('처음')
    const history = new History()

    history.record(doc)
    insertText(doc, position(0, 0, 2), ' 추가')
    expect(documentText(doc)).toBe('처음 추가')

    const undone = history.undo(doc)
    expect(undone).toBeDefined()
    doc = undone!
    expect(documentText(doc)).toBe('처음')

    const redone = history.redo(doc)
    expect(documentText(redone!)).toBe('처음 추가')
  })

  it('가능한 작업을 알려 준다', () => {
    const doc = doc1('a')
    const history = new History()
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    history.record(doc)
    expect(history.canUndo).toBe(true)
    history.undo(doc)
    expect(history.canRedo).toBe(true)
  })

  it('새 편집이 기록되면 다시 실행 스택을 버린다', () => {
    const doc = doc1('a')
    const history = new History()
    history.record(doc)
    history.undo(doc)
    expect(history.canRedo).toBe(true)
    history.record(doc)
    expect(history.canRedo).toBe(false)
  })

  it('보관하는 양에 상한을 둔다', () => {
    const doc = doc1('a')
    const history = new History(3)
    for (let i = 0; i < 10; i++) history.record(doc)
    expect(history.depth).toBe(3)
  })

  it('실행 취소할 것이 없으면 undefined를 반환한다', () => {
    expect(new History().undo(doc1())).toBeUndefined()
  })
})

describe('snapshot', () => {
  it('구조를 깊은 복사한다', () => {
    const doc = doc1('원본')
    const copy = snapshot(doc)
    insertText(copy, position(0, 0, 0), 'X')
    expect(documentText(doc)).toBe('원본')
    expect(documentText(copy)).toBe('X원본')
  })

  it('이미지 데이터를 복제하지 않고 공유한다', () => {
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const doc = new DocumentBuilder().image(data).build()
    const copy = snapshot(doc)
    expect(copy.binData[0]!.data).toBe(doc.binData[0]!.data)
  })
})
