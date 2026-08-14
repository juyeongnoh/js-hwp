/**
 * `BodyText/Section{N}`: 문단 스트림.
 *
 * 미묘한 부분은 `PARA_TEXT`다. 코드 0-31이 컨트롤인 UTF-16 버퍼 하나이고, 각
 * 컨트롤은 세 *형태* 중 하나를 갖는다.
 *
 * | 형태     | 코드 단위 | 배치                                  |
 * |----------|-----------|--------------------------------------|
 * | char     | 1         | 코드 하나뿐                           |
 * | inline   | 8         | `[code][페이로드 6단위][code]`        |
 * | extended | 8         | 같은 모양이고 `CTRL_HEADER`에 묶인다  |
 *
 * 확장 컨트롤은 다음 `CTRL_HEADER` 레코드를 순서대로 소비한다. 텍스트 안의 표가
 * 자기 표 레코드를 찾는 방식이 이것이다. 코드의 형태를 틀리면 문단 전체가
 * 어긋나므로, 아래 표는 빠짐없고 `docs/spec/04-bodytext-records.md`에서 곧장
 * 가져왔다.
 */

import {
  type Control,
  type HwpDocument,
  type InlineItem,
  type Paragraph,
  type Run,
  type Section,
  PageBreakInTable,
  type TableCell,
  type TableRow,
  VerticalAlign,
  defaultPageDef,
} from '@js-hwp/core'
import { ByteReader, ByteWriter, bit, bits, setBit, setBits } from './bytes.js'
import { type RecordNode, RecordWriter, buildRecordTree, childWithTag, parseRecords } from './record.js'
import { CtrlId, SectionTag } from './tags.js'

/** 문자 코드로 인덱싱한 제어 문자 형태. */
export const CONTROL_FORM: readonly ('char' | 'inline' | 'extended')[] = [
  'char', // 0x00
  'extended', // 0x01 reserved but extended
  'extended', // 0x02 section / column definition
  'extended', // 0x03 field start
  'inline', // 0x04 field end
  'inline', // 0x05 reserved
  'inline', // 0x06 reserved
  'inline', // 0x07 reserved
  'inline', // 0x08 title mark
  'inline', // 0x09 tab
  'char', // 0x0A line break
  'extended', // 0x0B drawing object / table
  'extended', // 0x0C reserved
  'char', // 0x0D paragraph break
  'extended', // 0x0E reserved
  'extended', // 0x0F hidden comment
  'extended', // 0x10 header / footer
  'extended', // 0x11 footnote / endnote
  'extended', // 0x12 auto number
  'inline', // 0x13 reserved
  'inline', // 0x14 reserved
  'extended', // 0x15 page control
  'extended', // 0x16 bookmark / index mark
  'extended', // 0x17 dutmal / overlapping letters
  'char', // 0x18 hyphen
  'char', // 0x19 reserved
  'char', // 0x1A reserved
  'char', // 0x1B reserved
  'char', // 0x1C reserved
  'char', // 0x1D reserved
  'char', // 0x1E no-break space
  'char', // 0x1F fixed-width space
]

/** 파일에서 셀 세로 정렬은 0=위, 1=가운데, 2=아래다. */
export const CELL_VERTICAL_ALIGN_FROM_WIRE = [
  VerticalAlign.Top,
  VerticalAlign.Center,
  VerticalAlign.Bottom,
]

/** 모델의 VerticalAlign으로 인덱싱한다. Baseline은 셀에 대응물이 없다. */
export const CELL_VERTICAL_ALIGN_TO_WIRE = [0, 0, 1, 2]

export const CHAR_TAB = 0x09
export const CHAR_LINE_BREAK = 0x0a
export const CHAR_PARA_BREAK = 0x0d
export const CHAR_HYPHEN = 0x18
export const CHAR_NBSP = 0x1e
export const CHAR_FIXED_SPACE = 0x1f
export const CHAR_TITLE_MARK = 0x08
export const CHAR_FIELD_START = 0x03
export const CHAR_FIELD_END = 0x04
export const CHAR_OBJECT = 0x0b

/** 네 글자 컨트롤 id를 읽으면서 디스크상 바이트 역순을 되돌린다. */
export function readCtrlId(value: number): string {
  return (
    String.fromCharCode((value >>> 24) & 0xff) +
    String.fromCharCode((value >>> 16) & 0xff) +
    String.fromCharCode((value >>> 8) & 0xff) +
    String.fromCharCode(value & 0xff)
  )
}

export function writeCtrlId(id: string): number {
  const padded = id.padEnd(4, ' ')
  return (
    ((padded.charCodeAt(0) << 24) |
      (padded.charCodeAt(1) << 16) |
      (padded.charCodeAt(2) << 8) |
      padded.charCodeAt(3)) >>>
    0
  )
}

// ---------------------------------------------------------------------------
// 읽기
// ---------------------------------------------------------------------------

interface ParseContext {
  doc: HwpDocument
  /** `fieldBegin`과 `fieldEnd`가 짝을 이루도록 하는 필드 id. */
  fieldStack: number[]
  nextFieldId: number
}

/** `BodyText/Section{N}` 스트림 하나를 파싱한다. */
export function parseSection(doc: HwpDocument, data: Uint8Array): Section {
  const tree = buildRecordTree(parseRecords(data))
  const context: ParseContext = { doc, fieldStack: [], nextFieldId: 1 }

  const section: Section = { pageDef: defaultPageDef(), paragraphs: [] }
  section.paragraphs = readParagraphList(tree, context, section)
  if (section.paragraphs.length === 0) {
    section.paragraphs.push({ paraShapeId: 0, styleId: 0, runs: [{ charShapeId: 0, items: [] }] })
  }
  return section
}

function readParagraphList(
  nodes: RecordNode[],
  context: ParseContext,
  section?: Section,
): Paragraph[] {
  const paragraphs: Paragraph[] = []
  for (const node of nodes) {
    if (node.tagId !== SectionTag.ParaHeader) continue
    paragraphs.push(readParagraph(node, context, section))
  }
  return paragraphs
}

function readParagraph(node: RecordNode, context: ParseContext, section?: Section): Paragraph {
  const reader = new ByteReader(node.payload)
  const packed = reader.uint32()
  const charCount = packed & 0x7fffffff
  reader.uint32() // control mask; the text itself is authoritative
  const paraShapeId = reader.uint16()
  const styleId = reader.uint8()
  const divideSort = reader.uint8()
  reader.optionalUint16() // char shape count
  reader.optionalUint16() // range tag count
  reader.optionalUint16() // line align count
  const instanceId = reader.optionalUint32()

  const paragraph: Paragraph = { paraShapeId, styleId, runs: [] }
  if (instanceId) paragraph.id = instanceId
  // divideSort 비트 2가 쪽 나눔, 비트 1이 단 나눔이다.
  if (bit(divideSort, 2)) paragraph.pageBreak = true
  if (bit(divideSort, 1)) paragraph.columnBreak = true

  const textRecord = childWithTag(node, SectionTag.ParaText)
  const charShapeRecord = childWithTag(node, SectionTag.ParaCharShape)
  const controlNodes = node.children.filter((child) => child.tagId === SectionTag.CtrlHeader)

  const charShapes = charShapeRecord ? readParaCharShape(charShapeRecord) : []
  const items = textRecord
    ? readParaText(textRecord.payload, controlNodes, context, section, charCount)
    : []

  paragraph.runs = buildRuns(items, charShapes)
  if (paragraph.runs.length === 0) paragraph.runs.push({ charShapeId: 0, items: [] })
  return paragraph
}

function readParaCharShape(node: RecordNode): { position: number; charShapeId: number }[] {
  const reader = new ByteReader(node.payload)
  const out: { position: number; charShapeId: number }[] = []
  while (reader.hasMore(8)) {
    out.push({ position: reader.uint32(), charShapeId: reader.uint32() })
  }
  return out
}

/** 인라인 항목과 그것이 시작하는 문자 오프셋. */
interface PositionedItem {
  position: number
  item: InlineItem
}

function readParaText(
  payload: Uint8Array,
  controlNodes: RecordNode[],
  context: ParseContext,
  section: Section | undefined,
  declaredCharCount: number,
): PositionedItem[] {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const total = Math.min(Math.floor(payload.byteLength / 2), declaredCharCount || Infinity)

  const items: PositionedItem[] = []
  let controlIndex = 0
  let pending = ''
  let pendingStart = 0
  let position = 0

  const flush = (): void => {
    if (pending === '') return
    items.push({ position: pendingStart, item: { type: 'text', value: pending } })
    pending = ''
  }

  while (position < total) {
    const code = view.getUint16(position * 2, true)

    if (code >= 32) {
      if (pending === '') pendingStart = position
      pending += String.fromCharCode(code)
      position++
      continue
    }

    const form = CONTROL_FORM[code] ?? 'char'
    flush()

    if (form === 'char') {
      const item = charControlItem(code)
      if (item) items.push({ position, item })
      position++
      continue
    }

    // 인라인과 확장 컨트롤 둘 다 8 코드 단위를 차지한다.
    const start = position
    position += 8

    if (form === 'extended') {
      const node = controlNodes[controlIndex++]
      const control = node ? readControl(node, context, section) : undefined
      if (control) items.push({ position: start, item: control })
      continue
    }

    const item = inlineControlItem(code, view, start, context)
    if (item) items.push({ position: start, item })
  }
  flush()

  return items
}

function charControlItem(code: number): InlineItem | undefined {
  switch (code) {
    case CHAR_LINE_BREAK:
      return { type: 'lineBreak' }
    case CHAR_HYPHEN:
      return { type: 'specialChar', char: 'hyphen' }
    case CHAR_NBSP:
      return { type: 'specialChar', char: 'nbsp' }
    case CHAR_FIXED_SPACE:
      return { type: 'specialChar', char: 'fixedWidthSpace' }
    default:
      // 0x0D는 문단을 끝내고 0x00은 나타나면 안 된다.
      return undefined
  }
}

function inlineControlItem(
  code: number,
  view: DataView,
  start: number,
  context: ParseContext,
): InlineItem | undefined {
  switch (code) {
    case CHAR_TAB: {
      const width = view.getUint32((start + 1) * 2, true)
      return { type: 'tab', width: width || undefined }
    }
    case CHAR_TITLE_MARK:
      return { type: 'specialChar', char: 'titleMark' }
    case CHAR_FIELD_END: {
      const id = context.fieldStack.pop()
      return id === undefined ? undefined : { type: 'fieldEnd', id }
    }
    default:
      return undefined
  }
}

function readControl(
  node: RecordNode,
  context: ParseContext,
  section: Section | undefined,
): Control | undefined {
  const reader = new ByteReader(node.payload)
  const ctrlId = readCtrlId(reader.uint32())

  switch (ctrlId) {
    case CtrlId.SectionDefinition:
      if (section) readSectionDefinition(node, section)
      return undefined
    case CtrlId.ColumnDefinition:
      if (section) readColumnDefinition(reader, section)
      return undefined
    case CtrlId.Table:
      return readTable(node, reader, context)
    case CtrlId.Header:
    case CtrlId.Footer:
      return {
        type: ctrlId === CtrlId.Header ? 'header' : 'footer',
        applyTo: reader.optionalUint32(),
        paragraphs: readNestedParagraphs(node, context),
      }
    case CtrlId.Footnote:
    case CtrlId.Endnote:
      return {
        type: ctrlId === CtrlId.Footnote ? 'footnote' : 'endnote',
        paragraphs: readNestedParagraphs(node, context),
      }
    case CtrlId.HiddenComment:
      return { type: 'hiddenComment', paragraphs: readNestedParagraphs(node, context) }
    case CtrlId.Bookmark:
      return { type: 'bookmark', name: readBookmarkName(node) }
    case CtrlId.AutoNumber:
      return {
        type: 'autoNumber',
        numberKind: reader.optionalUint32() & 0x0f,
        numberFormat: 0,
      }
    case CtrlId.DrawingObject:
      return readDrawingObject(node, context)
    default:
      if (ctrlId.startsWith('%')) return readField(ctrlId, node, reader, context)
      return { type: 'unknown', ctrlId, raw: node.payload }
  }
}

function readField(
  ctrlId: string,
  node: RecordNode,
  reader: ByteReader,
  context: ParseContext,
): Control {
  const properties = reader.optionalUint32()
  reader.optionalUint8() // reserved
  const instanceId = reader.optionalUint32()

  const id = context.nextFieldId++
  context.fieldStack.push(id)

  // 명령 문자열은 뒤따르는 CTRL_DATA / 파라미터 블록에 있다.
  const dataNode = childWithTag(node, SectionTag.CtrlData)
  const command = dataNode ? readFieldCommand(dataNode) : undefined

  return {
    type: 'fieldBegin',
    fieldKind: FIELD_KIND_BY_CTRL_ID[ctrlId] ?? 0,
    id,
    command,
    instanceId,
    dirty: bit(properties, 0),
  }
}

const FIELD_KIND_BY_CTRL_ID: Record<string, number> = {
  [CtrlId.FieldDate]: 1,
  [CtrlId.FieldDocDate]: 2,
  [CtrlId.FieldPath]: 3,
  [CtrlId.FieldBookmark]: 4,
  [CtrlId.FieldMailMerge]: 5,
  [CtrlId.FieldCrossRef]: 6,
  [CtrlId.FieldFormula]: 7,
  [CtrlId.FieldClickHere]: 8,
  [CtrlId.FieldSummary]: 9,
  [CtrlId.FieldUserInfo]: 10,
  [CtrlId.FieldHyperlink]: 11,
  [CtrlId.FieldMemo]: 22,
  [CtrlId.FieldPrivateInfo]: 23,
  [CtrlId.FieldTableOfContents]: 24,
}

function readFieldCommand(node: RecordNode): string | undefined {
  const reader = new ByteReader(node.payload)
  const value = reader.optionalString()
  return value === '' ? undefined : value
}

function readBookmarkName(node: RecordNode): string {
  const dataNode = childWithTag(node, SectionTag.CtrlData)
  if (!dataNode) return ''
  const reader = new ByteReader(dataNode.payload)
  // 책갈피 이름은 파라미터 셋 안에 있다. 첫 문자열이 그것이다.
  reader.optionalUint32()
  return reader.optionalString()
}

function readNestedParagraphs(node: RecordNode, context: ParseContext): Paragraph[] {
  const listHeader = childWithTag(node, SectionTag.ListHeader)
  const source = listHeader ?? node
  const paragraphs = readParagraphList(source.children, context)
  return paragraphs.length > 0
    ? paragraphs
    : [{ paraShapeId: 0, styleId: 0, runs: [{ charShapeId: 0, items: [] }] }]
}

function readSectionDefinition(node: RecordNode, section: Section): void {
  const pageDefNode = childWithTag(node, SectionTag.PageDef)
  if (!pageDefNode) return

  const reader = new ByteReader(pageDefNode.payload)
  const width = reader.hwpUnit()
  const height = reader.hwpUnit()
  const left = reader.hwpUnit()
  const right = reader.hwpUnit()
  const top = reader.hwpUnit()
  const bottom = reader.hwpUnit()
  const header = reader.hwpUnit()
  const footer = reader.hwpUnit()
  const gutter = reader.hwpUnit()
  const properties = reader.optionalUint32()

  section.pageDef = {
    width,
    height,
    margins: { left, right, top, bottom, header, footer, gutter },
    landscape: bit(properties, 0),
    gutterKind: bits(properties, 1, 2),
  }
}

function readColumnDefinition(reader: ByteReader, section: Section): void {
  const properties = reader.optionalUint16()
  const count = bits(properties, 2, 9)
  if (count <= 1) return
  section.columnDef = {
    count,
    kind: bits(properties, 0, 1),
    direction: bits(properties, 10, 11),
    sameWidth: bit(properties, 12),
    gap: reader.optionalUint16(),
  }
}

function readTable(node: RecordNode, reader: ByteReader, context: ParseContext): Control {
  const placement = readObjectPlacement(reader)

  const tableNode = childWithTag(node, SectionTag.Table)
  const rowSizes: number[] = []
  let rowCount = 0
  let colCount = 0
  let cellSpacing = 0
  let margins = { left: 0, right: 0, top: 0, bottom: 0 }
  let borderFillId = 0
  let pageBreak = 0
  let repeatHeaderRows = 0

  if (tableNode) {
    const t = new ByteReader(tableNode.payload)
    const properties = t.uint32()
    rowCount = t.uint16()
    colCount = t.uint16()
    cellSpacing = t.hwpUnit16()
    margins = {
      left: t.hwpUnit16(),
      right: t.hwpUnit16(),
      top: t.hwpUnit16(),
      bottom: t.hwpUnit16(),
    }
    for (let i = 0; i < rowCount && t.hasMore(2); i++) rowSizes.push(t.uint16())
    borderFillId = t.optionalUint16()
    pageBreak = bits(properties, 0, 1)
    repeatHeaderRows = bit(properties, 2) ? 1 : 0
  }

  // 셀은 컨트롤의 LIST_HEADER 자식이고 행 우선 순서다.
  const cellNodes = node.children.filter((child) => child.tagId === SectionTag.ListHeader)
  const rows: TableRow[] = Array.from({ length: Math.max(rowCount, 1) }, () => ({ cells: [] }))

  for (const cellNode of cellNodes) {
    const cell = readTableCell(cellNode, context)
    const row = rows[cell.row] ?? rows[rows.length - 1]
    row?.cells.push(cell)
  }

  return {
    type: 'table',
    placement,
    rows: rows.filter((row) => row.cells.length > 0),
    cellMargins: margins,
    cellSpacing,
    borderFillId,
    pageBreak,
    repeatHeaderRows,
  }
}

function readTableCell(node: RecordNode, context: ParseContext): TableCell {
  const reader = new ByteReader(node.payload)
  reader.int32() // paragraph count
  const properties = reader.optionalUint32()

  const col = reader.optionalUint16()
  const row = reader.optionalUint16()
  const colSpan = Math.max(1, reader.optionalUint16(1))
  const rowSpan = Math.max(1, reader.optionalUint16(1))
  const width = reader.optionalUint32()
  const height = reader.optionalUint32()
  const margins = {
    left: reader.optionalUint16(),
    right: reader.optionalUint16(),
    top: reader.optionalUint16(),
    bottom: reader.optionalUint16(),
  }
  const borderFillId = reader.optionalUint16()

  return {
    col,
    row,
    colSpan,
    rowSpan,
    width,
    height,
    margins,
    borderFillId: Math.max(0, borderFillId - 1),
    // 파일의 값은 0=위, 1=가운데, 2=아래다. 모델의 VerticalAlign은 셀이 가질
    // 수 없는 Baseline에서 시작하므로 하나 밀어준다.
    verticalAlign: (CELL_VERTICAL_ALIGN_FROM_WIRE[bits(properties, 5, 6)] ??
      VerticalAlign.Top) as VerticalAlign,
    paragraphs: readParagraphList(node.children, context),
  }
}

function readDrawingObject(node: RecordNode, context: ParseContext): Control | undefined {
  const pictureNode = childWithTag(node, SectionTag.ShapeComponentPicture)
  const shapeNode = childWithTag(node, SectionTag.ShapeComponent)
  const reader = new ByteReader(node.payload)
  reader.uint32() // ctrl id, already consumed by the caller's reader
  const placement = readObjectPlacement(reader)

  if (pictureNode) {
    const p = new ByteReader(pictureNode.payload)
    p.uint8() // border style
    p.uint8()
    p.uint32()
    p.uint32()
    // 바이너리 데이터 id는 네 모서리 점과 자르기 사각형 뒤에 있다. 모든 필드를
    // 모델링하는 대신 거기까지 건너뛴다.
    const binDataId = findBinDataId(pictureNode.payload)
    return {
      type: 'picture',
      binDataId: binDataId ?? 0,
      placement,
    }
  }

  void shapeNode
  void context
  return { type: 'unknown', ctrlId: CtrlId.DrawingObject, placement, raw: node.payload }
}

/**
 * 그림 레코드의 `binItemId`는 고정 크기 접두부 뒤에 오는 UINT16이다. 한글
 * 버전마다 접두부 패딩이 달라서, 고정 오프셋을 믿는 대신 그럴듯한 첫 id를
 * 훑어 찾는다.
 */
function findBinDataId(payload: Uint8Array): number | undefined {
  // 명세가 문서화하는 배치에서 id는 오프셋 74에 저장된다.
  if (payload.length >= 76) {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const candidate = view.getUint16(74, true)
    if (candidate > 0 && candidate < 0x1000) return candidate - 1
  }
  return undefined
}

function readObjectPlacement(reader: ByteReader): Control extends { placement: infer P } ? P : never {
  const properties = reader.optionalUint32()
  const offsetY = reader.optionalInt32()
  const offsetX = reader.optionalInt32()
  const width = reader.optionalUint32()
  const height = reader.optionalUint32()
  const zOrder = reader.optionalInt32()
  const marginTop = reader.optionalInt16()
  const marginBottom = reader.optionalInt16()
  const marginLeft = reader.optionalInt16()
  const marginRight = reader.optionalInt16()
  const instanceId = reader.optionalUint32()

  return {
    treatAsChar: bit(properties, 0),
    affectLineSpacing: bit(properties, 2),
    vertRelTo: bits(properties, 3, 4),
    vertAlign: bits(properties, 5, 7),
    horzRelTo: bits(properties, 8, 9),
    horzAlign: bits(properties, 10, 12),
    flowWithText: bit(properties, 13),
    allowOverlap: bit(properties, 14),
    textWrap: bits(properties, 21, 23),
    textFlowSide: bits(properties, 24, 25),
    offsetX,
    offsetY,
    width,
    height,
    zOrder,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    instanceId,
  } as never
}

/** 글자 모양 맵을 써서 위치가 정해진 항목들을 run으로 묶는다. */
function buildRuns(
  items: PositionedItem[],
  charShapes: { position: number; charShapeId: number }[],
): Run[] {
  const shapeAt = (position: number): number => {
    let current = charShapes[0]?.charShapeId ?? 0
    for (const entry of charShapes) {
      if (entry.position > position) break
      current = entry.charShapeId
    }
    return current
  }

  const runs: Run[] = []
  for (const { position, item } of items) {
    // 텍스트 항목이 모양 경계를 걸칠 수 있으므로 맵이 말하는 자리에서 쪼갠다.
    if (item.type === 'text') {
      let offset = 0
      while (offset < item.value.length) {
        const start = position + offset
        const shapeId = shapeAt(start)
        const next = charShapes.find((entry) => entry.position > start)
        const end =
          next && next.position < position + item.value.length
            ? next.position - position
            : item.value.length
        append(runs, shapeId, { type: 'text', value: item.value.slice(offset, end) })
        offset = end
      }
      continue
    }
    append(runs, shapeAt(position), item)
  }
  return runs
}

function append(runs: Run[], charShapeId: number, item: InlineItem): void {
  if (item.type === 'text' && item.value === '') return
  const last = runs[runs.length - 1]
  if (last && last.charShapeId === charShapeId) {
    const lastItem = last.items[last.items.length - 1]
    if (lastItem?.type === 'text' && item.type === 'text') {
      lastItem.value += item.value
      return
    }
    last.items.push(item)
    return
  }
  runs.push({ charShapeId, items: [item] })
}

// ---------------------------------------------------------------------------
// 쓰기
// ---------------------------------------------------------------------------

/** 구역을 `BodyText/Section{N}` 스트림으로 직렬화한다. */
export function serializeSection(doc: HwpDocument, section: Section, isFirst: boolean): Uint8Array {
  const writer = new RecordWriter()
  section.paragraphs.forEach((paragraph, index) => {
    writeParagraph(writer, doc, paragraph, index === 0 && isFirst ? section : undefined)
  })
  return writer.finish()
}

interface EncodedText {
  /** 컨트롤을 포함한 문단 텍스트의 UTF-16 코드 단위. */
  codes: number[]
  /** 글자 모양 맵 항목. */
  charShapes: { position: number; charShapeId: number }[]
  /** `CTRL_HEADER`가 필요한 컨트롤. 나타나는 순서대로. */
  extended: { control: Control }[]
  controlMask: number
}

function encodeParagraphText(paragraph: Paragraph, sectionForDefinition?: Section): EncodedText {
  const codes: number[] = []
  const charShapes: { position: number; charShapeId: number }[] = []
  const extended: { control: Control }[] = []
  let controlMask = 0
  let lastShapeId = -1

  const mark = (code: number): void => {
    controlMask |= 1 << code
  }

  const pushExtended = (code: number, control: Control): void => {
    mark(code)
    extended.push({ control })
    codes.push(code, 0, 0, 0, 0, 0, 0, code)
  }

  const pushInline = (code: number, payload: number[] = []): void => {
    mark(code)
    codes.push(code)
    for (let i = 0; i < 6; i++) codes.push(payload[i] ?? 0)
    codes.push(code)
  }

  // 구역 정의는 맨 앞에 컨트롤 0x02로 내보낸다.
  if (sectionForDefinition) {
    mark(0x02)
    extended.push({ control: { type: 'unknown', ctrlId: CtrlId.SectionDefinition } })
    codes.push(0x02, 0, 0, 0, 0, 0, 0, 0x02)
  }

  for (const run of paragraph.runs) {
    if (run.charShapeId !== lastShapeId) {
      charShapes.push({ position: codes.length, charShapeId: run.charShapeId })
      lastShapeId = run.charShapeId
    }
    for (const item of run.items) {
      switch (item.type) {
        case 'text':
          for (let i = 0; i < item.value.length; i++) codes.push(item.value.charCodeAt(i))
          break
        case 'tab': {
          const width = item.width ?? 0
          pushInline(CHAR_TAB, [width & 0xffff, (width >>> 16) & 0xffff])
          break
        }
        case 'lineBreak':
          mark(CHAR_LINE_BREAK)
          codes.push(CHAR_LINE_BREAK)
          break
        case 'specialChar':
          switch (item.char) {
            case 'hyphen':
              codes.push(CHAR_HYPHEN)
              break
            case 'nbsp':
              codes.push(CHAR_NBSP)
              break
            case 'fixedWidthSpace':
              codes.push(CHAR_FIXED_SPACE)
              break
            case 'titleMark':
              pushInline(CHAR_TITLE_MARK)
              break
          }
          break
        case 'pageBreak':
        case 'columnBreak':
          break
        case 'fieldEnd':
          pushInline(CHAR_FIELD_END)
          break
        default:
          pushExtended(controlCharFor(item), item)
          break
      }
    }
  }

  if (charShapes.length === 0) {
    charShapes.push({ position: 0, charShapeId: paragraph.runs[0]?.charShapeId ?? 0 })
  }

  return { codes, charShapes, extended, controlMask }
}

function controlCharFor(control: Control): number {
  switch (control.type) {
    case 'table':
    case 'picture':
    case 'equation':
    case 'line':
    case 'rectangle':
    case 'ellipse':
    case 'arc':
    case 'polygon':
    case 'curve':
    case 'container':
    case 'textArt':
    case 'ole':
      return CHAR_OBJECT
    case 'header':
    case 'footer':
      return 0x10
    case 'footnote':
    case 'endnote':
      return 0x11
    case 'autoNumber':
    case 'newNumber':
      return 0x12
    case 'pageNumberPosition':
    case 'pageHiding':
    case 'pageOddEvenAdjust':
      return 0x15
    case 'bookmark':
    case 'indexMark':
      return 0x16
    case 'dutmal':
    case 'compose':
      return 0x17
    case 'hiddenComment':
      return 0x0f
    case 'fieldBegin':
      return CHAR_FIELD_START
    default:
      return CHAR_OBJECT
  }
}

function writeParagraph(
  writer: RecordWriter,
  doc: HwpDocument,
  paragraph: Paragraph,
  sectionForDefinition?: Section,
): void {
  const encoded = encodeParagraphText(paragraph, sectionForDefinition)

  const header = new ByteWriter()
  // 비트 31이 리스트의 마지막 문단을 표시한다. 라이터가 아래에서 설정한다.
  header.uint32(encoded.codes.length)
  header.uint32(encoded.controlMask)
  header.uint16(paragraph.paraShapeId)
  header.uint8(paragraph.styleId)

  let divideSort = 0
  divideSort = setBit(divideSort, 1, paragraph.columnBreak)
  divideSort = setBit(divideSort, 2, paragraph.pageBreak)
  header.uint8(divideSort)

  header.uint16(encoded.charShapes.length)
  header.uint16(0) // range tag count
  header.uint16(0) // line align count — Hangul recomputes the layout cache
  header.uint32(paragraph.id ?? 0)

  writer.nested(SectionTag.ParaHeader, header, () => {
    const text = new ByteWriter()
    for (const code of encoded.codes) text.uint16(code)
    writer.write(SectionTag.ParaText, text)

    const shapes = new ByteWriter()
    for (const entry of encoded.charShapes) {
      shapes.uint32(entry.position)
      shapes.uint32(entry.charShapeId)
    }
    writer.write(SectionTag.ParaCharShape, shapes)

    for (const { control } of encoded.extended) {
      writeControl(writer, doc, control, sectionForDefinition)
    }
  })
}

function writeControl(
  writer: RecordWriter,
  doc: HwpDocument,
  control: Control,
  section?: Section,
): void {
  if (control.type === 'unknown' && control.ctrlId === CtrlId.SectionDefinition && section) {
    writeSectionDefinition(writer, section)
    return
  }

  switch (control.type) {
    case 'table':
      writeTable(writer, doc, control)
      return
    case 'header':
    case 'footer': {
      const header = new ByteWriter()
        .uint32(writeCtrlId(control.type === 'header' ? CtrlId.Header : CtrlId.Footer))
        .uint32(control.applyTo)
      writer.nested(SectionTag.CtrlHeader, header, () => {
        writeNestedParagraphs(writer, doc, control.paragraphs)
      })
      return
    }
    case 'footnote':
    case 'endnote': {
      const header = new ByteWriter().uint32(
        writeCtrlId(control.type === 'footnote' ? CtrlId.Footnote : CtrlId.Endnote),
      )
      writer.nested(SectionTag.CtrlHeader, header, () => {
        writeNestedParagraphs(writer, doc, control.paragraphs)
      })
      return
    }
    case 'bookmark': {
      const header = new ByteWriter().uint32(writeCtrlId(CtrlId.Bookmark))
      writer.nested(SectionTag.CtrlHeader, header, () => {
        const data = new ByteWriter().uint32(0).string(control.name)
        writer.write(SectionTag.CtrlData, data)
      })
      return
    }
    case 'fieldBegin': {
      const ctrlId =
        Object.entries(FIELD_KIND_BY_CTRL_ID).find(([, kind]) => kind === control.fieldKind)?.[0] ??
        CtrlId.FieldHyperlink
      const header = new ByteWriter().uint32(writeCtrlId(ctrlId)).uint32(0).uint8(0).uint32(control.instanceId ?? 0)
      writer.nested(SectionTag.CtrlHeader, header, () => {
        if (control.command) {
          writer.write(SectionTag.CtrlData, new ByteWriter().string(control.command))
        }
      })
      return
    }
    case 'picture':
      writePicture(writer, doc, control)
      return
    default: {
      const raw = control.type === 'unknown' ? control.raw : undefined
      if (raw) writer.write(SectionTag.CtrlHeader, raw)
      else writer.write(SectionTag.CtrlHeader, new ByteWriter().uint32(writeCtrlId(CtrlId.DrawingObject)))
      return
    }
  }
}

function writeNestedParagraphs(writer: RecordWriter, doc: HwpDocument, paragraphs: Paragraph[]): void {
  const listHeader = new ByteWriter().int32(paragraphs.length).uint32(0)
  writer.nested(SectionTag.ListHeader, listHeader, () => {
    for (const paragraph of paragraphs) writeParagraph(writer, doc, paragraph)
  })
}

function writeSectionDefinition(writer: RecordWriter, section: Section): void {
  const header = new ByteWriter()
  header.uint32(writeCtrlId(CtrlId.SectionDefinition))
  header.uint32(0) // properties
  header.uint16(0) // column spacing
  header.uint16(section.properties?.lineGrid ?? 0)
  header.uint16(section.properties?.charGrid ?? 0)
  header.hwpUnit(section.properties?.defaultTabStop ?? 4000)
  header.uint16(0) // numbering id
  header.uint16(0) // page starting number
  header.uint16(0)
  header.uint16(0)
  header.uint16(0)

  writer.nested(SectionTag.CtrlHeader, header, () => {
    const { pageDef } = section
    const page = new ByteWriter()
      .hwpUnit(pageDef.width)
      .hwpUnit(pageDef.height)
      .hwpUnit(pageDef.margins.left)
      .hwpUnit(pageDef.margins.right)
      .hwpUnit(pageDef.margins.top)
      .hwpUnit(pageDef.margins.bottom)
      .hwpUnit(pageDef.margins.header)
      .hwpUnit(pageDef.margins.footer)
      .hwpUnit(pageDef.margins.gutter)

    let properties = 0
    properties = setBit(properties, 0, pageDef.landscape)
    properties = setBits(properties, 1, 2, pageDef.gutterKind)
    page.uint32(properties)

    writer.write(SectionTag.PageDef, page)

    // 한글이 파일을 열려면 각주와 미주 모양이 반드시 있어야 한다.
    writer.write(SectionTag.FootnoteShape, noteShapeBytes())
    writer.write(SectionTag.FootnoteShape, noteShapeBytes())
  })
}

function noteShapeBytes(): ByteWriter {
  return new ByteWriter()
    .uint32(0) // properties
    .uint16(0x0029) // user character / prefix
    .uint16(0x0029)
    .uint16(0)
    .uint16(1) // start number
    .hwpUnit(0)
    .uint32(0)
    .uint8(0)
    .uint8(0)
    .color(0)
    .hwpUnit16(850)
    .hwpUnit16(567)
    .hwpUnit16(283)
    .uint16(0)
}

function writeTable(
  writer: RecordWriter,
  doc: HwpDocument,
  table: Extract<Control, { type: 'table' }>,
): void {
  const header = new ByteWriter().uint32(writeCtrlId(CtrlId.Table))
  writeObjectPlacement(header, table.placement)

  writer.nested(SectionTag.CtrlHeader, header, () => {
    const body = new ByteWriter()
    let properties = 0
    properties = setBits(properties, 0, 1, table.pageBreak ?? PageBreakInTable.Cell)
    properties = setBit(properties, 2, (table.repeatHeaderRows ?? 0) > 0)
    body.uint32(properties)
    body.uint16(table.rows.length)
    body.uint16(Math.max(...table.rows.map((r) => r.cells.reduce((n, c) => n + c.colSpan, 0)), 1))
    body.hwpUnit16(table.cellSpacing ?? 0)
    body.hwpUnit16(table.cellMargins.left)
    body.hwpUnit16(table.cellMargins.right)
    body.hwpUnit16(table.cellMargins.top)
    body.hwpUnit16(table.cellMargins.bottom)
    for (const row of table.rows) body.uint16(row.cells.length)
    body.uint16((table.borderFillId ?? 0) + 1)
    body.uint16(0) // valid zone count

    writer.write(SectionTag.Table, body)

    for (const row of table.rows) {
      for (const cell of row.cells) writeTableCell(writer, doc, cell)
    }
  })
}

function writeTableCell(writer: RecordWriter, doc: HwpDocument, cell: TableCell): void {
  const header = new ByteWriter()
  header.int32(cell.paragraphs.length)

  let properties = 0
  properties = setBits(properties, 5, 6, CELL_VERTICAL_ALIGN_TO_WIRE[cell.verticalAlign ?? VerticalAlign.Top] ?? 0)
  header.uint32(properties)

  header.uint16(cell.col)
  header.uint16(cell.row)
  header.uint16(cell.colSpan)
  header.uint16(cell.rowSpan)
  header.uint32(cell.width)
  header.uint32(cell.height)
  header.uint16(cell.margins?.left ?? 0)
  header.uint16(cell.margins?.right ?? 0)
  header.uint16(cell.margins?.top ?? 0)
  header.uint16(cell.margins?.bottom ?? 0)
  header.uint16((cell.borderFillId ?? 0) + 1)

  writer.nested(SectionTag.ListHeader, header, () => {
    for (const paragraph of cell.paragraphs) writeParagraph(writer, doc, paragraph)
  })
}

function writePicture(
  writer: RecordWriter,
  _doc: HwpDocument,
  picture: Extract<Control, { type: 'picture' }>,
): void {
  const header = new ByteWriter().uint32(writeCtrlId(CtrlId.DrawingObject))
  writeObjectPlacement(header, picture.placement)

  writer.nested(SectionTag.CtrlHeader, header, () => {
    const shape = new ByteWriter()
      .uint32(0) // instance id
      .int32(0) // x offset in group
      .int32(0)
      .uint32(0) // group level
      .uint16(0) // local version
      .int32(0)
      .int32(0)
      .uint32(picture.placement.width)
      .uint32(picture.placement.height)
      .uint32(0) // rotation
      .int32(0)
      .int32(0)
    writer.write(SectionTag.ShapeComponent, shape)

    const body = new ByteWriter()
    body.uint8(0).uint8(0).uint32(0).uint32(0) // border line
    for (let i = 0; i < 4; i++) {
      body.int32(i === 1 || i === 2 ? picture.placement.width : 0)
      body.int32(i >= 2 ? picture.placement.height : 0)
    }
    body.int32(0).int32(0).int32(0).int32(0) // crop
    body.uint16(0).uint16(0).uint16(0).uint16(0) // inner margins
    body.uint8(0).uint8(0).uint8(0) // brightness, contrast, effect
    body.uint16(picture.binDataId + 1)
    writer.write(SectionTag.ShapeComponentPicture, body)
  })
}

function writeObjectPlacement(
  writer: ByteWriter,
  placement: Extract<Control, { type: 'table' }>['placement'],
): void {
  let properties = 0
  properties = setBit(properties, 0, placement.treatAsChar)
  properties = setBit(properties, 2, placement.affectLineSpacing)
  properties = setBits(properties, 3, 4, placement.vertRelTo)
  properties = setBits(properties, 5, 7, placement.vertAlign ?? 0)
  properties = setBits(properties, 8, 9, placement.horzRelTo)
  properties = setBits(properties, 10, 12, placement.horzAlign ?? 0)
  properties = setBit(properties, 13, placement.flowWithText)
  properties = setBit(properties, 14, placement.allowOverlap)
  properties = setBits(properties, 21, 23, placement.textWrap ?? 0)
  properties = setBits(properties, 24, 25, placement.textFlowSide ?? 0)

  writer.uint32(properties)
  writer.int32(placement.offsetY)
  writer.int32(placement.offsetX)
  writer.uint32(placement.width)
  writer.uint32(placement.height)
  writer.int32(placement.zOrder ?? 0)
  writer.int16(placement.marginTop ?? 0)
  writer.int16(placement.marginBottom ?? 0)
  writer.int16(placement.marginLeft ?? 0)
  writer.int16(placement.marginRight ?? 0)
  writer.uint32(placement.instanceId ?? 0)
}
