/**
 * 문서 모델에 대한 편집 연산.
 *
 * 워드프로세서의 키 입력과 도구모음 버튼이 바뀌어 도착하는 것들이다. 앱이
 * 아니라 라이브러리에 사는 이유는, 스크립트로 하는 편집("이 파일 열고, 날짜
 * 바꾸고, 제목을 파랗게 하고, 저장")이 에디터와 정확히 같은 코드 경로를
 * 지나게 하기 위해서다.
 *
 * ## 위치
 *
 * 위치는 문단 하나에 그 문단의 평탄화된 텍스트 안 문자 오프셋을 더한 것이다.
 * 텍스트가 아닌 인라인 항목 — 탭, 줄바꿈, 표, 이미지 — 은 각각 정확히 한
 * 글자로 센다. 바이너리 포맷이 그것들을 문단 텍스트 안의 제어 문자로 저장하는
 * 방식을 그대로 반영한 것이다. 그래서 문단에 무엇이 들었든 오프셋이 안정적으로
 * 유지된다.
 */

import type { InlineItem, Paragraph, Run } from './model/controls.js'
import type { HwpDocument } from './model/document.js'
import type { CharShape, ParaShape } from './model/docinfo.js'
import { Resources } from './resources.js'
import {
  applyParagraphStyle as foldParagraphStyle,
  applyTextStyle as foldTextStyle,
  type ParagraphStyle,
  type TextStyle,
} from './style.js'

export interface DocPosition {
  sectionIndex: number
  paragraphIndex: number
  /** 문단 안의 문자 오프셋. */
  offset: number
}

export interface DocRange {
  start: DocPosition
  end: DocPosition
}

export const position = (
  sectionIndex: number,
  paragraphIndex: number,
  offset: number,
): DocPosition => ({ sectionIndex, paragraphIndex, offset })

/** `start`가 `end`보다 뒤에 오지 않도록 범위를 정규화한다. */
export function normalizeRange(range: DocRange): DocRange {
  return comparePositions(range.start, range.end) <= 0
    ? range
    : { start: range.end, end: range.start }
}

export function comparePositions(a: DocPosition, b: DocPosition): number {
  if (a.sectionIndex !== b.sectionIndex) return a.sectionIndex - b.sectionIndex
  if (a.paragraphIndex !== b.paragraphIndex) return a.paragraphIndex - b.paragraphIndex
  return a.offset - b.offset
}

export const isCollapsed = (range: DocRange): boolean =>
  comparePositions(range.start, range.end) === 0

// ---------------------------------------------------------------------------
// 원자 — 편집하기 쉬운 문단의 평평한 뷰
// ---------------------------------------------------------------------------

interface Atom {
  charShapeId: number
  item: InlineItem
}

/** 인라인 항목이 차지하는 글자 수. */
export function itemLength(item: InlineItem): number {
  return item.type === 'text' ? item.value.length : 1
}

/** 문단의 글자 길이. */
export function paragraphLength(paragraph: Paragraph): number {
  let total = 0
  for (const run of paragraph.runs) {
    for (const item of run.items) total += itemLength(item)
  }
  return total
}

function explode(paragraph: Paragraph): Atom[] {
  const atoms: Atom[] = []
  for (const run of paragraph.runs) {
    for (const item of run.items) atoms.push({ charShapeId: run.charShapeId, item })
  }
  return atoms
}

function implode(atoms: Atom[], fallbackCharShapeId: number): Run[] {
  const runs: Run[] = []
  for (const atom of atoms) {
    if (atom.item.type === 'text' && atom.item.value === '') continue
    const last = runs[runs.length - 1]
    if (last && last.charShapeId === atom.charShapeId) {
      const lastItem = last.items[last.items.length - 1]
      if (lastItem?.type === 'text' && atom.item.type === 'text') {
        lastItem.value += atom.item.value
        continue
      }
      last.items.push(atom.item)
      continue
    }
    runs.push({ charShapeId: atom.charShapeId, items: [atom.item] })
  }
  if (runs.length === 0) runs.push({ charShapeId: fallbackCharShapeId, items: [] })
  return runs
}

/**
 * `offset`에 원자 경계가 존재하도록 보장한다. 오프셋이 텍스트 원자 안에
 * 떨어지면 그걸 쪼갠다. 거기서 시작하는 원자의 인덱스를 반환한다.
 */
function splitAt(atoms: Atom[], offset: number): number {
  let consumed = 0
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]!
    const length = itemLength(atom.item)
    if (consumed === offset) return i
    if (consumed + length > offset) {
      if (atom.item.type !== 'text') {
        // 텍스트가 아닌 항목 안의 오프셋은 주소 지정할 수 없다. 시작으로 붙인다.
        return i
      }
      const cut = offset - consumed
      const head: Atom = { charShapeId: atom.charShapeId, item: { type: 'text', value: atom.item.value.slice(0, cut) } }
      const tail: Atom = { charShapeId: atom.charShapeId, item: { type: 'text', value: atom.item.value.slice(cut) } }
      atoms.splice(i, 1, head, tail)
      return i + 1
    }
    consumed += length
  }
  return atoms.length
}

// ---------------------------------------------------------------------------
// 문서 탐색
// ---------------------------------------------------------------------------

export function getParagraph(doc: HwpDocument, position: DocPosition): Paragraph | undefined {
  return doc.sections[position.sectionIndex]?.paragraphs[position.paragraphIndex]
}

function requireParagraph(doc: HwpDocument, position: DocPosition): Paragraph {
  const paragraph = getParagraph(doc, position)
  if (!paragraph) {
    throw new RangeError(
      `No paragraph at section ${position.sectionIndex}, paragraph ${position.paragraphIndex}`,
    )
  }
  return paragraph
}

/** 위치를 문서에 실제로 존재하는 어딘가로 제한한다. */
export function clampPosition(doc: HwpDocument, position: DocPosition): DocPosition {
  const sectionIndex = Math.max(0, Math.min(doc.sections.length - 1, position.sectionIndex))
  const section = doc.sections[sectionIndex]
  if (!section || section.paragraphs.length === 0) return { sectionIndex, paragraphIndex: 0, offset: 0 }
  const paragraphIndex = Math.max(0, Math.min(section.paragraphs.length - 1, position.paragraphIndex))
  const length = paragraphLength(section.paragraphs[paragraphIndex]!)
  return { sectionIndex, paragraphIndex, offset: Math.max(0, Math.min(length, position.offset)) }
}

/** 어떤 위치에서 유효한 글자 모양. 도구모음 상태 표시용. */
export function charShapeAt(doc: HwpDocument, position: DocPosition): CharShape | undefined {
  const paragraph = getParagraph(doc, position)
  if (!paragraph) return undefined
  const atoms = explode(paragraph)
  let consumed = 0
  // 캐럿 왼쪽 글자를 선호한다. 서식을 바꾼 뒤 계속 입력할 때 워드프로세서가
  // 쓰는 방식이다.
  for (const atom of atoms) {
    const length = itemLength(atom.item)
    if (consumed + length >= position.offset && position.offset > 0) {
      return doc.charShapes[atom.charShapeId]
    }
    consumed += length
  }
  const first = atoms[0] ?? { charShapeId: paragraph.runs[0]?.charShapeId ?? 0 }
  return doc.charShapes[first.charShapeId]
}

export function paraShapeAt(doc: HwpDocument, position: DocPosition): ParaShape | undefined {
  const paragraph = getParagraph(doc, position)
  return paragraph ? doc.paraShapes[paragraph.paraShapeId] : undefined
}

// ---------------------------------------------------------------------------
// 텍스트 편집
// ---------------------------------------------------------------------------

/** 어떤 위치에 텍스트를 삽입하고, 삽입 후 위치를 반환한다. */
export function insertText(
  doc: HwpDocument,
  at: DocPosition,
  text: string,
  charShapeId?: number,
): DocPosition {
  if (text === '') return at
  const paragraph = requireParagraph(doc, at)
  const atoms = explode(paragraph)
  const index = splitAt(atoms, at.offset)

  const inherited =
    charShapeId ??
    atoms[index - 1]?.charShapeId ??
    atoms[index]?.charShapeId ??
    paragraph.runs[0]?.charShapeId ??
    0

  atoms.splice(index, 0, { charShapeId: inherited, item: { type: 'text', value: text } })
  paragraph.runs = implode(atoms, inherited)
  return { ...at, offset: at.offset + text.length }
}

/** 텍스트가 아닌 항목(탭, 나눔, 표, 이미지 등)을 어떤 위치에 삽입한다. */
export function insertItem(doc: HwpDocument, at: DocPosition, item: InlineItem): DocPosition {
  const paragraph = requireParagraph(doc, at)
  const atoms = explode(paragraph)
  const index = splitAt(atoms, at.offset)
  const inherited =
    atoms[index - 1]?.charShapeId ?? atoms[index]?.charShapeId ?? paragraph.runs[0]?.charShapeId ?? 0
  atoms.splice(index, 0, { charShapeId: inherited, item })
  paragraph.runs = implode(atoms, inherited)
  return { ...at, offset: at.offset + itemLength(item) }
}

/** 범위 안의 모든 것을 지우고, 접힌 캐럿 위치를 반환한다. */
export function deleteRange(doc: HwpDocument, range: DocRange): DocPosition {
  const { start, end } = normalizeRange(range)
  if (comparePositions(start, end) === 0) return start

  if (start.sectionIndex !== end.sectionIndex) {
    // 구역 경계를 넘는 삭제는 쪽 설정을 병합해야 한다. 대신 시작 구역의
    // 끝까지만 지운다. 제거할 수 없는 구역 나눔에 선택이 걸쳐 있을 때
    // 한글이 하는 방식이다.
    const section = doc.sections[start.sectionIndex]
    if (!section) return start
    const lastIndex = section.paragraphs.length - 1
    return deleteRange(doc, {
      start,
      end: {
        sectionIndex: start.sectionIndex,
        paragraphIndex: lastIndex,
        offset: paragraphLength(section.paragraphs[lastIndex]!),
      },
    })
  }

  const section = doc.sections[start.sectionIndex]
  if (!section) return start

  if (start.paragraphIndex === end.paragraphIndex) {
    const paragraph = section.paragraphs[start.paragraphIndex]
    if (!paragraph) return start
    const atoms = explode(paragraph)
    const from = splitAt(atoms, start.offset)
    const to = splitAt(atoms, end.offset)
    const fallback = paragraph.runs[0]?.charShapeId ?? 0
    atoms.splice(from, to - from)
    paragraph.runs = implode(atoms, fallback)
    return start
  }

  const first = section.paragraphs[start.paragraphIndex]
  const last = section.paragraphs[end.paragraphIndex]
  if (!first || !last) return start

  const headAtoms = explode(first)
  headAtoms.length = splitAt(headAtoms, start.offset)

  const tailAtoms = explode(last)
  tailAtoms.splice(0, splitAt(tailAtoms, end.offset))

  const fallback = first.runs[0]?.charShapeId ?? 0
  first.runs = implode([...headAtoms, ...tailAtoms], fallback)
  section.paragraphs.splice(start.paragraphIndex + 1, end.paragraphIndex - start.paragraphIndex)
  return start
}

/** 어떤 위치에서 문단을 쪼갠다 — 엔터를 누를 때 일어나는 일. */
export function splitParagraph(doc: HwpDocument, at: DocPosition): DocPosition {
  const section = doc.sections[at.sectionIndex]
  const paragraph = requireParagraph(doc, at)

  const atoms = explode(paragraph)
  const index = splitAt(atoms, at.offset)
  const fallback = paragraph.runs[0]?.charShapeId ?? 0

  const tail = atoms.splice(index)
  paragraph.runs = implode(atoms, fallback)

  const style = doc.styles[paragraph.styleId]
  const created: Paragraph = {
    // 엔터를 누르면 스타일의 "다음 스타일"로 이동한다. 제목 뒤에 엔터를
    // 치면 본문으로 돌아오는 게 이 때문이다.
    paraShapeId: style ? doc.styles[style.nextStyleId]?.paraShapeId ?? paragraph.paraShapeId : paragraph.paraShapeId,
    styleId: style?.nextStyleId ?? paragraph.styleId,
    runs: implode(tail, tail[0]?.charShapeId ?? fallback),
  }
  section!.paragraphs.splice(at.paragraphIndex + 1, 0, created)

  return { sectionIndex: at.sectionIndex, paragraphIndex: at.paragraphIndex + 1, offset: 0 }
}

/** 문단을 앞 문단에 병합한다 — 오프셋 0에서 백스페이스를 누를 때의 동작. */
export function mergeWithPrevious(doc: HwpDocument, at: DocPosition): DocPosition {
  const section = doc.sections[at.sectionIndex]
  if (!section || at.paragraphIndex === 0) return at
  const previous = section.paragraphs[at.paragraphIndex - 1]
  const current = section.paragraphs[at.paragraphIndex]
  if (!previous || !current) return at

  const offset = paragraphLength(previous)
  const fallback = previous.runs[0]?.charShapeId ?? 0
  previous.runs = implode([...explode(previous), ...explode(current)], fallback)
  section.paragraphs.splice(at.paragraphIndex, 1)

  return { sectionIndex: at.sectionIndex, paragraphIndex: at.paragraphIndex - 1, offset }
}

/** 범위의 평문. */
export function textInRange(doc: HwpDocument, range: DocRange): string {
  const { start, end } = normalizeRange(range)
  const section = doc.sections[start.sectionIndex]
  if (!section) return ''

  const pieces: string[] = []
  for (let i = start.paragraphIndex; i <= end.paragraphIndex; i++) {
    const paragraph = section.paragraphs[i]
    if (!paragraph) break
    const from = i === start.paragraphIndex ? start.offset : 0
    const to = i === end.paragraphIndex ? end.offset : paragraphLength(paragraph)

    let consumed = 0
    let text = ''
    for (const run of paragraph.runs) {
      for (const item of run.items) {
        const length = itemLength(item)
        const itemStart = consumed
        consumed += length
        if (itemStart >= to || consumed <= from) continue
        if (item.type === 'text') {
          text += item.value.slice(Math.max(0, from - itemStart), Math.min(length, to - itemStart))
        } else if (item.type === 'tab') {
          text += '\t'
        }
      }
    }
    pieces.push(text)
  }
  return pieces.join('\n')
}

// ---------------------------------------------------------------------------
// 서식
// ---------------------------------------------------------------------------

/** 범위 전체에 글자 서식을 적용한다. */
export function formatText(doc: HwpDocument, range: DocRange, style: TextStyle): void {
  const { start, end } = normalizeRange(range)
  const section = doc.sections[start.sectionIndex]
  if (!section) return
  const resources = new Resources(doc)

  for (let i = start.paragraphIndex; i <= end.paragraphIndex; i++) {
    const paragraph = section.paragraphs[i]
    if (!paragraph) break

    const from = i === start.paragraphIndex ? start.offset : 0
    const to = i === end.paragraphIndex ? end.offset : paragraphLength(paragraph)
    if (from === to) continue

    const atoms = explode(paragraph)
    const fallback = paragraph.runs[0]?.charShapeId ?? 0
    // 먼 쪽 경계에서 먼저 쪼갠다. `from`에서 쪼개면 원자가 삽입되면서 뒤의
    // 모든 것이 밀릴 수 있어서, `to`는 그 뒤에 다시 해석한다.
    splitAt(atoms, to)
    const fromIndex = splitAt(atoms, from)
    const endIndex = indexAtOffset(atoms, to)
    for (let a = fromIndex; a < endIndex; a++) {
      const atom = atoms[a]!
      const base = doc.charShapes[atom.charShapeId] ?? doc.charShapes[0]
      if (!base) continue
      atom.charShapeId = resources.charShape(foldTextStyle(base, style, resources))
    }
    paragraph.runs = implode(atoms, fallback)
  }
}

function indexAtOffset(atoms: Atom[], offset: number): number {
  let consumed = 0
  for (let i = 0; i < atoms.length; i++) {
    if (consumed >= offset) return i
    consumed += itemLength(atoms[i]!.item)
  }
  return atoms.length
}

/** 범위가 걸치는 모든 문단에 문단 서식을 적용한다. */
export function formatParagraphs(doc: HwpDocument, range: DocRange, style: ParagraphStyle): void {
  const { start, end } = normalizeRange(range)
  const section = doc.sections[start.sectionIndex]
  if (!section) return
  const resources = new Resources(doc)

  for (let i = start.paragraphIndex; i <= end.paragraphIndex; i++) {
    const paragraph = section.paragraphs[i]
    if (!paragraph) break
    const base = doc.paraShapes[paragraph.paraShapeId] ?? doc.paraShapes[0]
    if (!base) continue
    paragraph.paraShapeId = resources.paraShape(foldParagraphStyle(base, style))
  }
}

/** 범위가 걸치는 모든 문단에 이름 있는 스타일을 적용한다. */
export function applyStyle(doc: HwpDocument, range: DocRange, styleName: string): boolean {
  const resources = new Resources(doc)
  const styleId = resources.styleByName(styleName)
  if (styleId === undefined) return false
  const style = doc.styles[styleId]!

  const { start, end } = normalizeRange(range)
  const section = doc.sections[start.sectionIndex]
  if (!section) return false

  for (let i = start.paragraphIndex; i <= end.paragraphIndex; i++) {
    const paragraph = section.paragraphs[i]
    if (!paragraph) break
    paragraph.styleId = styleId
    paragraph.paraShapeId = style.paraShapeId
    for (const run of paragraph.runs) run.charShapeId = style.charShapeId
  }
  return true
}

/**
 * 범위 안의 모든 글자가 이미 어떤 서식 속성을 갖는지 여부. 도구모음 버튼이
 * 눌린 상태로 그려지고 올바르게 토글되게 한다.
 */
export function rangeHasFormat(
  doc: HwpDocument,
  range: DocRange,
  predicate: (shape: CharShape) => boolean,
): boolean {
  const { start, end } = normalizeRange(range)
  const section = doc.sections[start.sectionIndex]
  if (!section) return false

  let sawAny = false
  for (let i = start.paragraphIndex; i <= end.paragraphIndex; i++) {
    const paragraph = section.paragraphs[i]
    if (!paragraph) break
    const from = i === start.paragraphIndex ? start.offset : 0
    const to = i === end.paragraphIndex ? end.offset : paragraphLength(paragraph)

    let consumed = 0
    for (const run of paragraph.runs) {
      for (const item of run.items) {
        const length = itemLength(item)
        const itemStart = consumed
        consumed += length
        if (itemStart >= to || consumed <= from) continue
        const shape = doc.charShapes[run.charShapeId]
        if (!shape) continue
        sawAny = true
        if (!predicate(shape)) return false
      }
    }
  }
  return sawAny
}

// ---------------------------------------------------------------------------
// 실행 취소 / 다시 실행
// ---------------------------------------------------------------------------

/**
 * 스냅숏 기반 이력.
 *
 * 스냅숏은 단순하고 항상 옳다. 한글이 쓰이는 크기의 문서에서는 그게 메모리보다
 * 중요하다. 바이너리 페이로드는 복사하지 않고 공유하므로, 이미지가 많은 문서가
 * 키 입력마다 크기가 불어나지 않는다.
 *
 */
export class History {
  readonly #past: HwpDocument[] = []
  readonly #future: HwpDocument[] = []
  readonly #limit: number

  constructor(limit = 200) {
    this.#limit = limit
  }

  get canUndo(): boolean {
    return this.#past.length > 0
  }

  get canRedo(): boolean {
    return this.#future.length > 0
  }

  get depth(): number {
    return this.#past.length
  }

  /** 변형 전 문서 상태를 기록한다. */
  record(doc: HwpDocument): void {
    this.#past.push(snapshot(doc))
    if (this.#past.length > this.#limit) this.#past.shift()
    this.#future.length = 0
  }

  undo(current: HwpDocument): HwpDocument | undefined {
    const previous = this.#past.pop()
    if (!previous) return undefined
    this.#future.push(snapshot(current))
    return previous
  }

  redo(current: HwpDocument): HwpDocument | undefined {
    const next = this.#future.pop()
    if (!next) return undefined
    this.#past.push(snapshot(current))
    return next
  }

  clear(): void {
    this.#past.length = 0
    this.#future.length = 0
  }
}

/** 문서를 깊은 복사한다. 바이너리 페이로드는 복제하지 않고 공유한다. */
export function snapshot(doc: HwpDocument): HwpDocument {
  const binData = doc.binData
  const preserved = doc.preserved
  const copy = structuredClone({ ...doc, binData: [], preserved: undefined }) as HwpDocument
  copy.binData = binData.map((item) => ({ ...item }))
  copy.preserved = preserved
  return copy
}
