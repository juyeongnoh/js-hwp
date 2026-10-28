/**
 * HTML 렌더링.
 *
 * 두 모드가 구현 하나를 공유한다.
 *
 * - `print`는 CSS Paged Media 규칙을 내보낸다. 그래서 크로미움의 `printToPDF`가
 *   문서의 실제 쪽 크기와 여백을 가진 PDF를 만든다.
 * - `screen`은 각 구역을 눈에 보이는 종이 한 장으로 그린다. 에디터가 보여주는
 *   게 이것이다.
 *
 * 페이지 나눔은 브라우저에 맡긴다. 한글의 줄바꿈 처리기를 다시 구현하는 게 쪽
 * 수를 미리 아는 유일한 방법인데, 그걸 미묘하게 틀리는 것보다 레이아웃 엔진에
 * 맡기는 편이 낫다.
 */

import {
  type BinDataItem,
  type Control,
  type HwpDocument,
  type InlineItem,
  type Paragraph,
  type PageDef,
  type Section,
  type TableCell,
  toHex,
  toPt,
  VerticalAlign,
} from '@js-hwp/core'
import {
  borderFillCss,
  borderLineCss,
  charShapeCss,
  cssPt,
  fillCss,
  num,
  paraShapeCss,
  styleAttr,
  VERTICAL_ALIGN_CSS,
} from './css.js'

export interface RenderOptions {
  /** PDF 내보내기는 `'print'`, 화면 보기는 `'screen'`. */
  mode?: 'print' | 'screen'
  /** 출력을 완전한 HTML 문서로 감싼다. 기본값 `true`. */
  standalone?: boolean
  /** `<title>` 요소에 쓸 문서 제목. */
  title?: string
  /** 생성된 규칙 뒤에 덧붙일 추가 CSS. */
  extraCss?: string
  /** 에디터의 WYSIWYG 표면을 위해 문단을 편집 가능하게 만든다. */
  editable?: boolean
  /** 요소를 모델 위치로 되돌려 대응시키는 `data-*` 속성을 내보낸다. */
  annotate?: boolean
  /** 임베드된 바이너리를 URL로 해석한다. 기본값은 `data:` URI. */
  resolveImage?: (item: BinDataItem, index: number) => string | undefined
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

function toDataUri(item: BinDataItem): string | undefined {
  if (!item.data) return undefined
  const mime = MIME_BY_EXTENSION[(item.extension ?? '').toLowerCase()] ?? 'application/octet-stream'
  return `data:${mime};base64,${base64(item.data)}`
}

function base64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

// ---------------------------------------------------------------------------

class HtmlRenderer {
  readonly #doc: HwpDocument
  readonly #options: Required<Pick<RenderOptions, 'mode' | 'editable' | 'annotate'>> & RenderOptions
  readonly #imageCache = new Map<number, string | undefined>()

  constructor(doc: HwpDocument, options: RenderOptions) {
    this.#doc = doc
    this.#options = {
      mode: options.mode ?? 'print',
      editable: options.editable ?? false,
      annotate: options.annotate ?? false,
      ...options,
    }
  }

  render(): string {
    const sections = this.#doc.sections
      .map((section, index) => this.#section(section, index))
      .join('\n')
    return sections
  }

  css(): string {
    const rules: string[] = [BASE_CSS]

    if (this.#options.mode === 'print') {
      this.#doc.sections.forEach((section, index) => {
        rules.push(pageRule(section.pageDef, index))
      })
      rules.push(PRINT_CSS)
    } else {
      rules.push(SCREEN_CSS)
      this.#doc.sections.forEach((section, index) => {
        const { pageDef } = section
        const width = pageDef.landscape ? pageDef.height : pageDef.width
        const height = pageDef.landscape ? pageDef.width : pageDef.height
        rules.push(
          `.hwp-section-${index}{width:${cssPt(width)};min-height:${cssPt(height)};` +
            `padding:${cssPt(pageDef.margins.top)} ${cssPt(pageDef.margins.right)} ` +
            `${cssPt(pageDef.margins.bottom)} ${cssPt(pageDef.margins.left)}}`,
        )
      })
    }

    if (this.#options.extraCss) rules.push(this.#options.extraCss)
    return rules.join('\n')
  }

  // -- 구역 ------------------------------------------------------------

  #section(section: Section, index: number): string {
    const body = section.paragraphs.map((p, i) => this.#paragraph(p, `${index}.${i}`)).join('\n')
    const columns = section.columnDef && section.columnDef.count > 1
      ? ` style="column-count:${section.columnDef.count};column-gap:${cssPt(section.columnDef.gap ?? 0)}"`
      : ''
    const editable = this.#options.editable ? ' contenteditable="true"' : ''
    const annotate = this.#options.annotate ? ` data-section="${index}"` : ''
    return `<section class="hwp-section hwp-section-${index}"${annotate}${editable}><div class="hwp-flow"${columns}>\n${body}\n</div></section>`
  }

  /** @internal — {@link renderParagraphHtml}이 쓴다. */
  paragraph(paragraph: Paragraph, path: string): string {
    return this.#paragraph(paragraph, path)
  }

  // -- 문단 ------------------------------------------------------------

  #paragraph(paragraph: Paragraph, path: string): string {
    const shape = this.#doc.paraShapes[paragraph.paraShapeId]
    const declarations = shape ? paraShapeCss(shape) : []
    if (paragraph.pageBreak) declarations.push('break-before:page')
    if (paragraph.columnBreak) declarations.push('break-before:column')

    if (shape?.border) {
      const fill = this.#doc.borderFills[shape.border.borderFillId]
      declarations.push(...borderFillCss(fill))
      declarations.push(
        `padding:${cssPt(shape.border.offsetTop)} ${cssPt(shape.border.offsetRight)} ` +
          `${cssPt(shape.border.offsetBottom)} ${cssPt(shape.border.offsetLeft)}`,
      )
    }

    const inner = paragraph.runs.map((run) => this.#run(run.charShapeId, run.items)).join('')
    const annotate = this.#options.annotate ? ` data-p="${path}"` : ''
    // 빈 문단도 한 줄을 차지하는데, <p></p>는 그러지 않는다.
    const content = inner === '' ? '<br>' : inner
    return `<p class="hwp-p"${annotate}${styleAttr(declarations)}>${content}</p>`
  }

  #run(charShapeId: number, items: InlineItem[]): string {
    const shape = this.#doc.charShapes[charShapeId]
    const declarations = shape ? charShapeCss(this.#doc, shape) : []
    const inner = items.map((item) => this.#item(item, charShapeId)).join('')
    if (inner === '') return ''
    return `<span class="hwp-run"${styleAttr(declarations)}>${inner}</span>`
  }

  #item(item: InlineItem, charShapeId: number): string {
    switch (item.type) {
      case 'text':
        return escapeHtml(item.value)
      case 'tab':
        return '<span class="hwp-tab">	</span>'
      case 'lineBreak':
        return '<br>'
      case 'pageBreak':
      case 'columnBreak':
        return ''
      case 'specialChar':
        return item.char === 'hyphen' ? '&#8209;' : '&nbsp;'
      default:
        return this.#control(item, charShapeId)
    }
  }

  // -- 컨트롤 ----------------------------------------------------------

  #control(control: Control, charShapeId: number): string {
    switch (control.type) {
      case 'table':
        return this.#table(control)
      case 'picture':
        return this.#picture(control)
      case 'rectangle':
      case 'ellipse':
      case 'line':
      case 'polygon':
      case 'curve':
      case 'arc':
      case 'connectLine':
      case 'container':
      case 'textArt':
      case 'ole':
        return this.#shape(control)
      case 'equation':
        return `<span class="hwp-equation" title="${escapeHtml(control.script)}">${escapeHtml(
          control.latex ?? control.script,
        )}</span>`
      case 'footnote':
      case 'endnote': {
        const body = control.paragraphs.map((p, i) => this.#paragraph(p, `note.${i}`)).join('')
        return `<span class="hwp-note-ref"><span class="hwp-note-body">${body}</span></span>`
      }
      case 'header':
      case 'footer': {
        const body = control.paragraphs.map((p, i) => this.#paragraph(p, `${control.type}.${i}`)).join('')
        return `<div class="hwp-${control.type}" data-apply-to="${control.applyTo}">${body}</div>`
      }
      case 'bookmark':
        return `<a class="hwp-bookmark" id="${escapeHtml(control.name)}"></a>`
      case 'fieldBegin':
        return control.fieldKind === 11 /* HyperLink */
          ? `<a class="hwp-link" href="${escapeHtml((control.command ?? '').split(';')[0] ?? '#')}">`
          : `<span class="hwp-field" data-kind="${control.fieldKind}">`
      case 'fieldEnd':
        return '</span>'
      case 'autoNumber':
        return '<span class="hwp-auto-number"></span>'
      case 'pageNumberPosition':
        return ''
      case 'memo':
      case 'hiddenComment':
        return ''
      default:
        void charShapeCss
        void charShapeId
        return ''
    }
  }

  #table(table: Extract<Control, { type: 'table' }>): string {
    const rows = table.rows
      .map((row) => {
        const cells = row.cells.map((cell) => this.#cell(cell, table)).join('')
        const height = row.height ? ` style="height:${cssPt(row.height)}"` : ''
        return `<tr${height}>${cells}</tr>`
      })
      .join('')

    const declarations = [
      'border-collapse:collapse',
      `width:${cssPt(table.placement.width)}`,
      'table-layout:fixed',
    ]
    if (table.placement.treatAsChar === false) declarations.push('float:left', 'margin:0 1em 0.5em 0')
    const outer = this.#doc.borderFills[table.borderFillId ?? 0]
    if (outer) declarations.push(...fillCss(outer.fill))

    const caption = table.placement.caption
    const captionHtml = caption
      ? `<caption style="caption-side:${caption.side === 2 ? 'top' : 'bottom'}">${caption.paragraphs
          .map((p, i) => this.#paragraph(p, `caption.${i}`))
          .join('')}</caption>`
      : ''

    return `<table class="hwp-table"${styleAttr(declarations)}>${captionHtml}<tbody>${rows}</tbody></table>`
  }

  #cell(cell: TableCell, table: Extract<Control, { type: 'table' }>): string {
    const fill = this.#doc.borderFills[cell.borderFillId ?? table.borderFillId ?? 0]
    const margins = cell.margins ?? table.cellMargins
    const declarations = [
      ...borderFillCss(fill),
      `padding:${cssPt(margins.top)} ${cssPt(margins.right)} ${cssPt(margins.bottom)} ${cssPt(margins.left)}`,
      `width:${cssPt(cell.width)}`,
      `vertical-align:${VERTICAL_ALIGN_CSS[cell.verticalAlign ?? VerticalAlign.Top] ?? 'top'}`,
    ]
    const attrs = [
      cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '',
      cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : '',
    ].join('')
    const body = cell.paragraphs.map((p, i) => this.#paragraph(p, `cell.${i}`)).join('')
    const tag = cell.header ? 'th' : 'td'
    return `<${tag}${attrs}${styleAttr(declarations)}>${body}</${tag}>`
  }

  #picture(picture: Extract<Control, { type: 'picture' }>): string {
    const src = this.#imageSrc(picture.binDataId)
    const { width, height, description } = picture.placement
    const declarations = [`width:${cssPt(width)}`, `height:${cssPt(height)}`]
    if (picture.placement.treatAsChar === false) declarations.push('float:left', 'margin:0 1em 0.5em 0')
    if (picture.rotation) declarations.push(`transform:rotate(${num(picture.rotation / 100)}deg)`)
    if (picture.alpha) declarations.push(`opacity:${num(1 - picture.alpha / 100)}`)

    if (!src) {
      return `<span class="hwp-image-missing"${styleAttr(declarations)}>[image]</span>`
    }
    return `<img class="hwp-image" src="${src}" alt="${escapeHtml(description ?? '')}"${styleAttr(declarations)}>`
  }

  #shape(shape: Extract<Control, { type: 'rectangle' }> | Control): string {
    if (!('placement' in shape) || !shape.placement) return ''
    const { width, height } = shape.placement
    const declarations = [
      'display:inline-block',
      `width:${cssPt(width)}`,
      `height:${cssPt(height)}`,
      'position:relative',
    ]
    if ('fill' in shape && shape.fill) declarations.push(...fillCss(shape.fill))
    if ('outline' in shape && shape.outline) declarations.push(`border:${borderLineCss(shape.outline.line)}`)
    if (shape.type === 'ellipse') declarations.push('border-radius:50%')
    if (shape.type === 'rectangle' && shape.cornerRadius) {
      declarations.push(`border-radius:${num(shape.cornerRadius)}%`)
    }
    if ('rotation' in shape && shape.rotation) {
      declarations.push(`transform:rotate(${num(shape.rotation / 100)}deg)`)
    }

    let inner = ''
    if ('textBox' in shape && shape.textBox) {
      inner = shape.textBox.paragraphs.map((p, i) => this.#paragraph(p, `shape.${i}`)).join('')
    }
    if (shape.type === 'textArt') inner = escapeHtml(shape.text)
    if (shape.type === 'container') {
      inner = shape.children.map((child) => this.#shape(child)).join('')
    }

    return `<span class="hwp-shape hwp-shape-${shape.type}"${styleAttr(declarations)}>${inner}</span>`
  }

  #imageSrc(binDataId: number): string | undefined {
    if (this.#imageCache.has(binDataId)) return this.#imageCache.get(binDataId)
    const item = this.#doc.binData[binDataId]
    const src = item
      ? (this.#options.resolveImage?.(item, binDataId) ?? toDataUri(item))
      : undefined
    this.#imageCache.set(binDataId, src)
    return src
  }
}

// ---------------------------------------------------------------------------

function pageRule(pageDef: PageDef, index: number): string {
  const width = pageDef.landscape ? pageDef.height : pageDef.width
  const height = pageDef.landscape ? pageDef.width : pageDef.height
  const { margins } = pageDef
  return (
    `@page hwp-page-${index}{size:${num(toPt(width))}pt ${num(toPt(height))}pt;` +
    `margin:${cssPt(margins.top)} ${cssPt(margins.right)} ${cssPt(margins.bottom)} ${cssPt(margins.left)}}\n` +
    `.hwp-section-${index}{page:hwp-page-${index}}`
  )
}

const BASE_CSS = `
.hwp-p{margin:0;padding:0;white-space:pre-wrap}
.hwp-run{white-space:pre-wrap}
.hwp-tab{white-space:pre;display:inline-block;min-width:2em}
.hwp-table{border-collapse:collapse;max-width:100%}
.hwp-table td,.hwp-table th{vertical-align:top}
.hwp-table th{font-weight:700}
.hwp-image{object-fit:contain;vertical-align:baseline}
.hwp-image-missing{display:inline-block;border:1px dashed #bbb;color:#999;font-size:9pt;text-align:center}
.hwp-link{color:inherit}
.hwp-equation{font-family:"Cambria Math","Latin Modern Math",serif;font-style:italic}
.hwp-note-body{display:none}
.hwp-header,.hwp-footer{display:none}
.hwp-bookmark{display:inline}
`.trim()

const PRINT_CSS = `
html,body{margin:0;padding:0;background:#fff}
.hwp-section{break-after:page}
.hwp-section:last-child{break-after:auto}
`.trim()

const SCREEN_CSS = `
html,body{margin:0;padding:0;background:#f2f3f5}
.hwp-section{background:#fff;margin:24px auto;box-shadow:0 1px 4px rgba(0,0,0,.18);box-sizing:border-box}
.hwp-section:focus{outline:none}
@media print{
  html,body{background:#fff}
  .hwp-section{margin:0;box-shadow:none;break-after:page}
}
`.trim()

/**
 * 문단 하나를 렌더링한다.
 *
 * 에디터는 키 입력마다 캐럿이 있는 문단만 다시 그린다. 문서 전체를 다시 그리는
 * 것도 옳긴 하지만, 문서가 수백 쪽에 이르면 너무 느리다.
 *
 */
export function renderParagraphHtml(
  doc: HwpDocument,
  sectionIndex: number,
  paragraphIndex: number,
  options: RenderOptions = {},
): string {
  const paragraph = doc.sections[sectionIndex]?.paragraphs[paragraphIndex]
  if (!paragraph) return ''
  const renderer = new HtmlRenderer(doc, options)
  return renderer.paragraph(paragraph, `${sectionIndex}.${paragraphIndex}`)
}

/** 문서 본문만 렌더링한다. */
export function renderBody(doc: HwpDocument, options: RenderOptions = {}): string {
  return new HtmlRenderer(doc, options).render()
}

/** 마크업 없이 문서의 스타일시트만. */
export function renderCss(doc: HwpDocument, options: RenderOptions = {}): string {
  return new HtmlRenderer(doc, options).css()
}

/** 문서를 HTML로 렌더링한다. 기본값은 완전한 페이지. */
export function renderToHtml(doc: HwpDocument, options: RenderOptions = {}): string {
  const renderer = new HtmlRenderer(doc, options)
  const body = renderer.render()
  if (options.standalone === false) return body

  const title = escapeHtml(options.title ?? doc.meta.title ?? 'HWP Document')
  return `<!DOCTYPE html>
<html lang="${doc.meta.language ?? 'ko'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${renderer.css()}
</style>
</head>
<body>
${body}
</body>
</html>`
}

export { toHex }
