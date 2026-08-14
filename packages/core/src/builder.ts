/**
 * 문서 빌더 — 코드로 HWP 문서를 만드는 정문.
 *
 * ```ts
 * const doc = new DocumentBuilder()
 *   .meta({ title: '분기 보고서', author: '홍길동' })
 *   .heading(1, '1. 개요')
 *   .paragraph('올해 3분기 실적을 정리한 문서입니다.')
 *   .paragraph((p) =>
 *     p.text('매출은 ').bold('전년 대비 12% 증가').text('했습니다.'))
 *   .table([['항목', '금액'], ['매출', '1,200']], { header: true })
 *   .build()
 * ```
 *
 * 모든 메서드가 `this`를 반환하고, 빌더는 {@link HwpDocument} 하나를 제자리에서
 * 변형한다. 서식은 {@link Resources}를 거쳐 인터닝되므로 같은 스타일을 반복해도
 * 비용이 없다.
 */

import { createDocument, defaultCharShape, defaultParaShape, defaultPageDef } from './defaults.js'
import { parseColor } from './model/color.js'
import {
  type Caption,
  CaptionSide,
  type CellMargins,
  DEFAULT_PLACEMENT,
  type FieldBeginControl,
  FieldKind,
  type InlineItem,
  type ObjectPlacement,
  type Paragraph,
  type PictureControl,
  RelativeTo,
  type Run,
  type TableCell,
  type TableControl,
  type TableRow,
} from './model/controls.js'
import { BinDataKind, HeadingKind, StyleKind, type Numbering } from './model/docinfo.js'
import type { DocumentMeta, HwpDocument } from './model/document.js'
import {
  type ColumnDef,
  ColumnKind,
  type PageDef,
  type Section,
  type PageMargins,
} from './model/section.js'
import { PAPER, type HwpUnit, type PaperSizeName, mm, parseLength, pt } from './model/units.js'
import { Resources } from './resources.js'
import {
  applyParagraphStyle,
  applyTextStyle,
  type ParagraphStyle,
  type TextStyle,
} from './style.js'

const length = (value: number | string | undefined, fallback: HwpUnit): HwpUnit =>
  value === undefined ? fallback : typeof value === 'number' ? value : parseLength(value)

// ---------------------------------------------------------------------------
// 문단 빌더
// ---------------------------------------------------------------------------

/** 문단 하나의 run을 만든다. */
export class ParagraphBuilder {
  readonly #resources: Resources
  readonly #runs: Run[] = []
  #baseCharShapeId: number
  #paraShapeId: number
  #styleId = 0
  #pageBreak = false
  #columnBreak = false

  constructor(resources: Resources, charShapeId: number, paraShapeId: number) {
    this.#resources = resources
    this.#baseCharShapeId = charShapeId
    this.#paraShapeId = paraShapeId
  }

  /** 선택적 인라인 스타일과 함께 텍스트를 덧붙인다. */
  text(value: string, style?: TextStyle): this {
    const charShapeId = style ? this.#shapeFor(style) : this.#baseCharShapeId
    this.#append(charShapeId, { type: 'text', value })
    return this
  }

  bold(value: string, style: TextStyle = {}): this {
    return this.text(value, { ...style, bold: true })
  }

  italic(value: string, style: TextStyle = {}): this {
    return this.text(value, { ...style, italic: true })
  }

  underline(value: string, style: TextStyle = {}): this {
    return this.text(value, { ...style, underline: true })
  }

  strike(value: string, style: TextStyle = {}): this {
    return this.text(value, { ...style, strikeout: true })
  }

  superscript(value: string, style: TextStyle = {}): this {
    return this.text(value, { ...style, superscript: true })
  }

  subscript(value: string, style: TextStyle = {}): this {
    return this.text(value, { ...style, subscript: true })
  }

  /** 이후의 스타일 없는 `text()` 호출이 쓸 스타일을 바꾼다. */
  style(style: TextStyle): this {
    this.#baseCharShapeId = this.#shapeFor(style)
    return this
  }

  /** 문단 수준 서식을 설정한다. */
  format(style: ParagraphStyle): this {
    this.#paraShapeId = this.#resources.paraShape(
      applyParagraphStyle(this.#resources.getParaShape(this.#paraShapeId), style),
    )
    if (style.pageBreakBefore) this.#pageBreak = true
    return this
  }

  /** 이름 있는 문단 스타일을 적용한다. 예: `'개요 1'`, `'Normal'`. */
  useStyle(name: string): this {
    const id = this.#resources.styleByName(name)
    if (id === undefined) throw new Error(`Unknown style: ${name}`)
    this.#styleId = id
    const style = this.#resources.document.styles[id]!
    this.#paraShapeId = style.paraShapeId
    this.#baseCharShapeId = style.charShapeId
    return this
  }

  tab(): this {
    this.#append(this.#baseCharShapeId, { type: 'tab' })
    return this
  }

  /** 부드러운 줄바꿈 — 같은 문단, 새 줄. */
  lineBreak(): this {
    this.#append(this.#baseCharShapeId, { type: 'lineBreak' })
    return this
  }

  /** 묶음 빈칸. */
  nbsp(): this {
    this.#append(this.#baseCharShapeId, { type: 'specialChar', char: 'nbsp' })
    return this
  }

  /** `label`을 감싸는 하이퍼링크. */
  link(label: string, url: string, style: TextStyle = {}): this {
    const id = nextFieldId()
    const begin: FieldBeginControl = {
      type: 'fieldBegin',
      fieldKind: FieldKind.HyperLink,
      id,
      // 한글은 하이퍼링크를 `command;target;...`으로 저장한다. 뒤의 필드는
      // 창을 고르는 것이고 기본값으로 둔다.
      command: `${url};;0;;`,
      name: 'HyperLink',
    }
    const charShapeId = this.#shapeFor({
      color: '#0000ff',
      underline: true,
      ...style,
    })
    this.#append(charShapeId, begin)
    this.#append(charShapeId, { type: 'text', value: label })
    this.#append(charShapeId, { type: 'fieldEnd', id })
    return this
  }

  /** 하이퍼링크와 상호 참조가 가리킬 수 있는 책갈피 앵커. */
  bookmark(name: string): this {
    this.#append(this.#baseCharShapeId, { type: 'bookmark', name })
    return this
  }

  /** 본문을 `body`가 만드는 각주. */
  footnote(body: string | ((p: ParagraphBuilder) => void)): this {
    this.#append(this.#baseCharShapeId, {
      type: 'footnote',
      paragraphs: [buildParagraph(this.#resources, body, this.#baseCharShapeId, this.#paraShapeId)],
    })
    return this
  }

  endnote(body: string | ((p: ParagraphBuilder) => void)): this {
    this.#append(this.#baseCharShapeId, {
      type: 'endnote',
      paragraphs: [buildParagraph(this.#resources, body, this.#baseCharShapeId, this.#paraShapeId)],
    })
    return this
  }

  /** HWP 수식 스크립트로 된 인라인 수식. */
  equation(script: string, options: { size?: number; latex?: string } = {}): this {
    this.#append(this.#baseCharShapeId, {
      type: 'equation',
      placement: { ...DEFAULT_PLACEMENT, treatAsChar: true },
      script,
      charSize: options.size !== undefined ? pt(options.size) : undefined,
      latex: options.latex,
    })
    return this
  }

  /** 이미 만들어둔 컨트롤(이미지, 표, 도형 등)을 덧붙인다. */
  control(item: InlineItem): this {
    this.#append(this.#baseCharShapeId, item)
    return this
  }

  /** 이 문단을 새 쪽으로 강제한다. */
  pageBreak(): this {
    this.#pageBreak = true
    return this
  }

  columnBreak(): this {
    this.#columnBreak = true
    return this
  }

  #shapeFor(style: TextStyle): number {
    return this.#resources.charShape(
      applyTextStyle(this.#resources.getCharShape(this.#baseCharShapeId), style, this.#resources),
    )
  }

  #append(charShapeId: number, item: InlineItem): void {
    const last = this.#runs[this.#runs.length - 1]
    if (last && last.charShapeId === charShapeId) {
      const lastItem = last.items[last.items.length - 1]
      if (lastItem?.type === 'text' && item.type === 'text') {
        lastItem.value += item.value
        return
      }
      last.items.push(item)
      return
    }
    this.#runs.push({ charShapeId, items: [item] })
  }

  /** @internal */
  finish(): Paragraph {
    const paragraph: Paragraph = {
      paraShapeId: this.#paraShapeId,
      styleId: this.#styleId,
      runs: this.#runs.length > 0 ? this.#runs : [{ charShapeId: this.#baseCharShapeId, items: [] }],
    }
    if (this.#pageBreak) paragraph.pageBreak = true
    if (this.#columnBreak) paragraph.columnBreak = true
    return paragraph
  }
}

let fieldCounter = 0
const nextFieldId = (): number => ++fieldCounter

function buildParagraph(
  resources: Resources,
  content: string | ((p: ParagraphBuilder) => void),
  charShapeId: number,
  paraShapeId: number,
): Paragraph {
  const builder = new ParagraphBuilder(resources, charShapeId, paraShapeId)
  if (typeof content === 'string') builder.text(content)
  else content(builder)
  return builder.finish()
}

// ---------------------------------------------------------------------------
// 표 빌더
// ---------------------------------------------------------------------------

export interface TableOptions {
  /** 첫 행을 반복되는 제목 행으로 취급한다. */
  header?: boolean
  /** 열 너비. 기본값은 텍스트 폭을 균등 분할한 것. */
  columnWidths?: (number | string)[]
  /** 표 전체 너비. 기본값은 구역의 텍스트 폭. */
  width?: number | string
  rowHeight?: number | string
  /** 모든 셀에 적용할 테두리/채우기 인덱스. */
  borderFillId?: number
  cellMargins?: Partial<CellMargins>
  /** 표를 떠 있게 두지 않고 인라인으로 배치한다. */
  inline?: boolean
  caption?: string
  captionSide?: 'top' | 'bottom' | 'left' | 'right'
}

/** 평문보다 풍부한 내용을 위해 표를 셀 단위로 만든다. */
export class TableBuilder {
  readonly #resources: Resources
  readonly #rows: TableRow[] = []
  readonly #rowCount: number
  readonly #colCount: number
  readonly #columnWidths: HwpUnit[]
  readonly #rowHeight: HwpUnit
  readonly #borderFillId: number
  readonly #charShapeId: number
  readonly #paraShapeId: number

  constructor(
    resources: Resources,
    rowCount: number,
    colCount: number,
    columnWidths: HwpUnit[],
    rowHeight: HwpUnit,
    borderFillId: number,
    charShapeId: number,
    paraShapeId: number,
  ) {
    this.#resources = resources
    this.#rowCount = rowCount
    this.#colCount = colCount
    this.#columnWidths = columnWidths
    this.#rowHeight = rowHeight
    this.#borderFillId = borderFillId
    this.#charShapeId = charShapeId
    this.#paraShapeId = paraShapeId

    for (let r = 0; r < rowCount; r++) {
      const cells: TableCell[] = []
      for (let c = 0; c < colCount; c++) {
        cells.push({
          col: c,
          row: r,
          colSpan: 1,
          rowSpan: 1,
          width: columnWidths[c] ?? 0,
          height: rowHeight,
          borderFillId,
          paragraphs: [
            { paraShapeId, styleId: 0, runs: [{ charShapeId, items: [] }] },
          ],
        })
      }
      this.#rows.push({ cells, height: rowHeight })
    }
  }

  /** 셀의 내용을 설정한다. */
  cell(
    row: number,
    col: number,
    content: string | ((p: ParagraphBuilder) => void),
    options: { style?: ParagraphStyle; text?: TextStyle; borderFillId?: number } = {},
  ): this {
    const target = this.#cellAt(row, col)
    let charShapeId = this.#charShapeId
    if (options.text) {
      charShapeId = this.#resources.charShape(
        applyTextStyle(this.#resources.getCharShape(charShapeId), options.text, this.#resources),
      )
    }
    let paraShapeId = this.#paraShapeId
    if (options.style) {
      paraShapeId = this.#resources.paraShape(
        applyParagraphStyle(this.#resources.getParaShape(paraShapeId), options.style),
      )
    }
    target.paragraphs = [buildParagraph(this.#resources, content, charShapeId, paraShapeId)]
    if (options.borderFillId !== undefined) target.borderFillId = options.borderFillId
    return this
  }

  /** 문자열 배열로 행 하나를 통째로 채운다. */
  row(index: number, values: (string | ((p: ParagraphBuilder) => void))[], options?: {
    style?: ParagraphStyle
    text?: TextStyle
  }): this {
    values.forEach((value, col) => this.cell(index, col, value, options ?? {}))
    return this
  }

  /**
   * 직사각형 셀 블록을 병합한다. 좌상단 셀이 내용을 유지하면서 커지고,
   * 그것이 덮는 셀들은 제거된다. HWP가 병합을 모델링하는 방식이다.
   */
  merge(row: number, col: number, rowSpan: number, colSpan: number): this {
    const anchor = this.#cellAt(row, col)
    anchor.rowSpan = rowSpan
    anchor.colSpan = colSpan
    anchor.width = this.#columnWidths.slice(col, col + colSpan).reduce((a, b) => a + b, 0)
    anchor.height = this.#rowHeight * rowSpan

    for (let r = row; r < row + rowSpan; r++) {
      const target = this.#rows[r]
      if (!target) continue
      target.cells = target.cells.filter(
        (cell) =>
          !(cell.row >= row && cell.row < row + rowSpan && cell.col >= col && cell.col < col + colSpan) ||
          (cell.row === row && cell.col === col),
      )
    }
    return this
  }

  /** 행을 반복되는 제목 행으로 표시한다. */
  headerRow(index: number): this {
    for (const cell of this.#rows[index]?.cells ?? []) cell.header = true
    return this
  }

  #cellAt(row: number, col: number): TableCell {
    const found = this.#rows[row]?.cells.find((c) => c.col === col)
    if (!found) {
      throw new RangeError(
        `No cell at row ${row}, column ${col} (table is ${this.#rowCount}x${this.#colCount}; it may be covered by a merge)`,
      )
    }
    return found
  }

  /** @internal */
  finish(): TableRow[] {
    return this.#rows
  }
}

// ---------------------------------------------------------------------------
// 문서 빌더
// ---------------------------------------------------------------------------

export interface PageOptions {
  paper?: PaperSizeName | { width: number | string; height: number | string }
  landscape?: boolean
  margins?: Partial<Record<keyof PageMargins, number | string>>
}

export interface ImageOptions {
  width?: number | string
  height?: number | string
  /** 파일 확장자. 없으면 바이트에서 추론한다. */
  format?: string
  /** 이미지를 인라인(기본값)으로 배치할지 떠 있게 할지. */
  inline?: boolean
  caption?: string
  alt?: string
}

export interface ListOptions {
  /** •는 `'bullet'`, 1. 2. 3.은 `'number'`. */
  kind?: 'bullet' | 'number'
  /** 중첩 수준. 0부터 시작. */
  level?: number
  /** `kind`가 `'bullet'`일 때의 글머리표 문자. */
  bullet?: string
}

export class DocumentBuilder {
  readonly #doc: HwpDocument
  readonly #resources: Resources
  #section: Section
  #charShapeId = 0
  #paraShapeId = 0

  constructor(doc: HwpDocument = createDocument()) {
    this.#doc = doc
    this.#resources = new Resources(doc)
    const section = doc.sections[0]
    if (!section) {
      const created = { pageDef: defaultPageDef(), paragraphs: [] }
      doc.sections.push(created)
      this.#section = created
    } else {
      this.#section = section
    }
  }

  get document(): HwpDocument {
    return this.#doc
  }

  get resources(): Resources {
    return this.#resources
  }

  meta(meta: DocumentMeta): this {
    Object.assign(this.#doc.meta, meta)
    return this
  }

  /** 현재 구역의 쪽 크기와 여백을 설정한다. */
  page(options: PageOptions): this {
    const pageDef: PageDef = { ...this.#section.pageDef, margins: { ...this.#section.pageDef.margins } }
    if (options.paper) {
      const size =
        typeof options.paper === 'string'
          ? PAPER[options.paper]
          : { width: parseLength(options.paper.width), height: parseLength(options.paper.height) }
      pageDef.width = size.width
      pageDef.height = size.height
    }
    if (options.landscape !== undefined) pageDef.landscape = options.landscape
    if (options.margins) {
      for (const [key, value] of Object.entries(options.margins)) {
        if (value === undefined) continue
        pageDef.margins[key as keyof PageMargins] = parseLength(value)
      }
    }
    this.#section.pageDef = pageDef
    return this
  }

  /** 현재 구역을 여러 단으로 나눈다. */
  columns(count: number, options: Partial<Omit<ColumnDef, 'count'>> = {}): this {
    this.#section.columnDef = {
      count,
      kind: ColumnKind.Normal,
      gap: mm(8),
      sameWidth: true,
      ...options,
    }
    return this
  }

  /** 이후 문단의 기본 글자 서식. */
  defaultTextStyle(style: TextStyle): this {
    this.#charShapeId = this.#resources.charShape(
      applyTextStyle(this.#resources.getCharShape(this.#charShapeId), style, this.#resources),
    )
    return this
  }

  defaultParagraphStyle(style: ParagraphStyle): this {
    this.#paraShapeId = this.#resources.paraShape(
      applyParagraphStyle(this.#resources.getParaShape(this.#paraShapeId), style),
    )
    return this
  }

  /** 문단을 덧붙인다. */
  paragraph(
    content: string | ((p: ParagraphBuilder) => void) = '',
    style?: ParagraphStyle,
  ): this {
    const paraShapeId = style
      ? this.#resources.paraShape(
          applyParagraphStyle(this.#resources.getParaShape(this.#paraShapeId), style),
        )
      : this.#paraShapeId
    this.#section.paragraphs.push(
      buildParagraph(this.#resources, content, this.#charShapeId, paraShapeId),
    )
    return this
  }

  /** 문단 여러 개를 한꺼번에 덧붙인다. */
  paragraphs(contents: string[], style?: ParagraphStyle): this {
    for (const content of contents) this.paragraph(content, style)
    return this
  }

  /**
   * 제목을 덧붙인다. 수준 1-7이 한글 기본 제공 `개요 N` 스타일에 대응되고
   * 점점 작아지는 진한 글자가 된다.
   */
  heading(level: number, text: string, style: TextStyle = {}): this {
    const clamped = Math.max(1, Math.min(7, Math.round(level)))
    const sizes = [16, 14, 13, 12, 11, 11, 11]
    const styleId = this.#resources.styleByName(`개요 ${clamped}`) ?? 0

    const charShapeId = this.#resources.charShape(
      applyTextStyle(
        this.#resources.getCharShape(this.#charShapeId),
        { bold: true, size: sizes[clamped - 1], ...style },
        this.#resources,
      ),
    )
    const paraShapeId = this.#resources.paraShape({
      ...this.#resources.getParaShape(this.#paraShapeId),
      marginTop: pt(clamped <= 2 ? 12 : 8),
      marginBottom: pt(4),
      keepWithNext: true,
      headingKind: HeadingKind.Outline,
      headingLevel: clamped - 1,
    })

    const paragraph = buildParagraph(this.#resources, text, charShapeId, paraShapeId)
    paragraph.styleId = styleId
    this.#section.paragraphs.push(paragraph)
    return this
  }

  /** 글머리표 목록이나 번호 목록을 덧붙인다. */
  list(items: (string | ((p: ParagraphBuilder) => void))[], options: ListOptions = {}): this {
    const level = options.level ?? 0
    const kind = options.kind ?? 'bullet'
    const indentStep = pt(20)

    const paraShapeId = this.#resources.paraShape({
      ...this.#resources.getParaShape(this.#paraShapeId),
      marginLeft: indentStep * (level + 1),
      indent: -indentStep,
      headingKind: kind === 'bullet' ? HeadingKind.Bullet : HeadingKind.Number,
      headingLevel: level,
      headingId: kind === 'number' ? this.#ensureNumbering() : this.#ensureBullet(options.bullet),
    })

    for (const item of items) {
      this.#section.paragraphs.push(
        buildParagraph(this.#resources, item, this.#charShapeId, paraShapeId),
      )
    }
    return this
  }

  /**
   * 표를 덧붙인다. 단순한 내용은 2차원 배열을, 셀을 개별로 만들려면 콜백을
   * 넘긴다.
   */
  table(
    content: string[][] | { rows: number; cols: number },
    options: TableOptions = {},
    build?: (t: TableBuilder) => void,
  ): this {
    const isArray = Array.isArray(content)
    const rowCount = isArray ? content.length : content.rows
    const colCount = isArray ? Math.max(...content.map((r) => r.length), 0) : content.cols
    if (rowCount === 0 || colCount === 0) throw new RangeError('A table needs at least one cell')

    const textWidth = this.#textWidth()
    const totalWidth = length(options.width, textWidth)
    const columnWidths =
      options.columnWidths?.map((w) => parseLength(w)) ??
      Array.from({ length: colCount }, () => Math.floor(totalWidth / colCount))

    const borderFillId = options.borderFillId ?? 1
    const rowHeight = length(options.rowHeight, pt(20))

    const builder = new TableBuilder(
      this.#resources,
      rowCount,
      colCount,
      columnWidths,
      rowHeight,
      borderFillId,
      this.#charShapeId,
      this.#paraShapeId,
    )

    if (isArray) {
      content.forEach((row, r) => {
        row.forEach((value, c) => {
          builder.cell(r, c, value, options.header && r === 0 ? { text: { bold: true } } : {})
        })
      })
      if (options.header) builder.headerRow(0)
    }
    build?.(builder)

    const margins: CellMargins = {
      left: mm(1.8),
      right: mm(1.8),
      top: mm(0.5),
      bottom: mm(0.5),
      ...options.cellMargins,
    }

    const rows = builder.finish()
    const height = rows.reduce((sum, row) => sum + (row.height ?? rowHeight), 0)

    const table: TableControl = {
      type: 'table',
      placement: {
        ...DEFAULT_PLACEMENT,
        treatAsChar: options.inline !== false,
        width: columnWidths.reduce((a, b) => a + b, 0),
        height,
        horzRelTo: RelativeTo.Column,
        vertRelTo: RelativeTo.Paragraph,
      },
      rows,
      cellMargins: margins,
      borderFillId,
      repeatHeaderRows: options.header ? 1 : 0,
    }

    if (options.caption) {
      table.placement.caption = this.#caption(options.caption, options.captionSide)
    }

    this.#section.paragraphs.push({
      paraShapeId: this.#paraShapeId,
      styleId: 0,
      runs: [{ charShapeId: this.#charShapeId, items: [table] }],
    })
    return this
  }

  /** 원시 바이트에서 이미지를 덧붙인다. */
  image(data: Uint8Array, options: ImageOptions = {}): this {
    const format = options.format ?? sniffImageFormat(data) ?? 'png'
    const binDataId = this.#doc.binData.length
    this.#doc.binData.push({
      kind: BinDataKind.Embedding,
      extension: format,
      data,
      id: `image${binDataId + 1}`,
    })

    const intrinsic = imageSize(data) ?? { width: 0, height: 0 }
    const width = length(options.width, intrinsic.width > 0 ? pxToHwp(intrinsic.width) : mm(50))
    const height = length(
      options.height,
      intrinsic.height > 0 && intrinsic.width > 0
        ? Math.round((width * intrinsic.height) / intrinsic.width)
        : mm(35),
    )

    const picture: PictureControl = {
      type: 'picture',
      binDataId,
      placement: {
        ...DEFAULT_PLACEMENT,
        treatAsChar: options.inline !== false,
        width,
        height,
        description: options.alt,
      },
      originalSize:
        intrinsic.width > 0
          ? { width: pxToHwp(intrinsic.width), height: pxToHwp(intrinsic.height) }
          : undefined,
    }

    if (options.caption) {
      picture.placement.caption = this.#caption(options.caption, 'bottom')
    }

    this.#section.paragraphs.push({
      paraShapeId: this.#paraShapeId,
      styleId: 0,
      runs: [{ charShapeId: this.#charShapeId, items: [picture] }],
    })
    return this
  }

  /** 강제 쪽 나눔을 삽입한다. */
  pageBreak(): this {
    this.#section.paragraphs.push({
      paraShapeId: this.#paraShapeId,
      styleId: 0,
      runs: [{ charShapeId: this.#charShapeId, items: [] }],
      pageBreak: true,
    })
    return this
  }

  /** 현재 구역의 반복 머리말을 설정한다. */
  header(content: string | ((p: ParagraphBuilder) => void)): this {
    return this.#runningTitle('header', content)
  }

  footer(content: string | ((p: ParagraphBuilder) => void)): this {
    return this.#runningTitle('footer', content)
  }

  /** 자체 쪽 설정을 가질 수 있는 새 구역을 시작한다. */
  section(options: PageOptions = {}): this {
    const created: Section = {
      pageDef: { ...this.#section.pageDef, margins: { ...this.#section.pageDef.margins } },
      paragraphs: [],
    }
    this.#doc.sections.push(created)
    this.#section = created
    if (Object.keys(options).length > 0) this.page(options)
    return this
  }

  build(): HwpDocument {
    // 문단이 하나도 없는 문서는 한글을 혼란시킨다. 하나는 보장한다.
    for (const section of this.#doc.sections) {
      if (section.paragraphs.length === 0) {
        section.paragraphs.push({
          paraShapeId: this.#paraShapeId,
          styleId: 0,
          runs: [{ charShapeId: this.#charShapeId, items: [] }],
        })
      }
    }
    return this.#doc
  }

  // -- 내부 구현 -----------------------------------------------------------

  #runningTitle(type: 'header' | 'footer', content: string | ((p: ParagraphBuilder) => void)): this {
    const paragraph = buildParagraph(this.#resources, content, this.#charShapeId, this.#paraShapeId)
    const first = this.#section.paragraphs[0]
    const control: InlineItem = { type, applyTo: 0, paragraphs: [paragraph] }
    if (first) {
      const run = first.runs[0]
      if (run) run.items.unshift(control)
      else first.runs.push({ charShapeId: this.#charShapeId, items: [control] })
    } else {
      this.#section.paragraphs.push({
        paraShapeId: this.#paraShapeId,
        styleId: 0,
        runs: [{ charShapeId: this.#charShapeId, items: [control] }],
      })
    }
    return this
  }

  #caption(text: string, side: TableOptions['captionSide'] = 'bottom'): Caption {
    const sides = { top: CaptionSide.Top, bottom: CaptionSide.Bottom, left: CaptionSide.Left, right: CaptionSide.Right }
    return {
      side: sides[side ?? 'bottom'],
      width: this.#textWidth(),
      gap: pt(5),
      paragraphs: [buildParagraph(this.#resources, text, this.#charShapeId, this.#paraShapeId)],
    }
  }

  #textWidth(): HwpUnit {
    const { width, margins } = this.#section.pageDef
    return width - margins.left - margins.right - margins.gutter
  }

  #ensureNumbering(): number {
    const numbering: Numbering = {
      levels: Array.from({ length: 7 }, (_, level) => ({
        format: `^${level + 1}.`,
        numberFormat: 0,
        align: 1,
        widthAdjust: 0,
        distance: 50,
        distanceIsRatio: true,
        startNumber: 1,
      })),
      startNumber: 1,
    }
    return this.#resources.numbering(numbering)
  }

  #ensureBullet(char = '•'): number {
    const existing = this.#doc.bullets.findIndex((b) => b.char === char)
    if (existing !== -1) return existing
    this.#doc.bullets.push({
      char,
      level: {
        format: char,
        numberFormat: 0,
        align: 1,
        widthAdjust: 0,
        distance: 50,
        distanceIsRatio: true,
      },
    })
    return this.#doc.bullets.length - 1
  }
}

// ---------------------------------------------------------------------------
// 이미지 헬퍼
// ---------------------------------------------------------------------------

const pxToHwp = (value: number): HwpUnit => Math.round((value * 7200) / 96)

/** 매직 바이트로 이미지 형식을 판별한다. */
export function sniffImageFormat(data: Uint8Array): string | undefined {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return 'png'
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg'
  if (data.length >= 6 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return 'gif'
  if (data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d) return 'bmp'
  if (
    data.length >= 12 &&
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) {
    return 'webp'
  }
  if (data.length >= 5 && data[0] === 0x3c && data[1] === 0x3f) return 'svg'
  return undefined
}

/** PNG, JPEG, GIF의 고유 픽셀 크기를 읽는다. */
export function imageSize(data: Uint8Array): { width: number; height: number } | undefined {
  const format = sniffImageFormat(data)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  if (format === 'png' && data.length >= 24) {
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) }
  }
  if (format === 'gif' && data.length >= 10) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  if (format === 'bmp' && data.length >= 26) {
    return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) }
  }
  if (format === 'jpg') {
    let offset = 2
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset++
        continue
      }
      const marker = data[offset + 1]!
      // SOF0..SOF15. 사이에 끼어 있는 DHT/DAC/RST 마커는 제외한다.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5, false), width: view.getUint16(offset + 7, false) }
      }
      offset += 2 + view.getUint16(offset + 2, false)
    }
  }
  return undefined
}

export { parseColor, StyleKind }
