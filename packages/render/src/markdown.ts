/**
 * 마크다운 내보내기.
 *
 * 버전 관리에서 문서를 diff하거나, 다른 도구에 넣거나, 빠르게 미리 볼 때
 * 유용하다. 일부러 손실이 있게 만들었다. 마크다운에는 쪽 기하 개념이 없다.
 * 다만 구조, 강조, 표, 링크, 이미지는 보존한다.
 *
 */

import {
  Align,
  type Control,
  type HwpDocument,
  type InlineItem,
  type Paragraph,
  type Run,
  HeadingKind,
} from '@js-hwp/core'

export interface MarkdownOptions {
  /** 이미지를 `![alt](data:...)`로 내보낸다. 기본값 `false`(자리표시자). */
  inlineImages?: boolean
  /** 각주를 마크다운 각주 정의로 포함한다. 기본값 `true`. */
  footnotes?: boolean
}

export function renderToMarkdown(doc: HwpDocument, options: MarkdownOptions = {}): string {
  const blocks: string[] = []
  const footnotes: string[] = []

  const renderRun = (run: Run, emphasis = true): string => {
    const shape = doc.charShapes[run.charShapeId]
    let text = run.items.map((item) => renderItem(item)).join('')
    if (!emphasis || text.trim() === '') return text
    // 강조 표시는 텍스트에 딱 붙어야 한다. 아니면 마크다운이 적용하지 않는다.
    const leading = /^\s*/.exec(text)![0]
    const trailing = /\s*$/.exec(text)![0]
    let core = text.slice(leading.length, text.length - trailing.length)
    if (shape?.strikeout) core = `~~${core}~~`
    if (shape?.italic) core = `*${core}*`
    if (shape?.bold) core = `**${core}**`
    text = leading + core + trailing
    return text
  }

  const renderItem = (item: InlineItem): string => {
    switch (item.type) {
      case 'text':
        return item.value.replace(/([\\`*_[\]])/g, '\\$1')
      case 'tab':
        return '  '
      case 'lineBreak':
        return '  \n'
      case 'specialChar':
        return item.char === 'hyphen' ? '-' : ' '
      case 'pageBreak':
      case 'columnBreak':
        return ''
      default:
        return renderControl(item)
    }
  }

  const renderControl = (control: Control): string => {
    switch (control.type) {
      case 'table':
        blocks.push(renderTable(control))
        return ''
      case 'picture': {
        const item = doc.binData[control.binDataId]
        const alt = control.placement.description ?? 'image'
        if (options.inlineImages && item?.data) {
          return `![${alt}](data:image/${item.extension};base64,${toBase64(item.data)})`
        }
        return `![${alt}](${item?.id ?? `binData${control.binDataId}`}.${item?.extension ?? 'png'})`
      }
      case 'equation':
        return `$${control.latex ?? control.script}$`
      case 'footnote':
      case 'endnote': {
        if (options.footnotes === false) return ''
        const index = footnotes.length + 1
        footnotes.push(
          `[^${index}]: ${control.paragraphs.map((p) => renderParagraphInline(p)).join(' ')}`,
        )
        return `[^${index}]`
      }
      case 'fieldBegin':
        return control.fieldKind === 11 ? '[' : ''
      case 'fieldEnd':
        return ''
      case 'bookmark':
        return `<a id="${control.name}"></a>`
      default:
        return ''
    }
  }

  const renderParagraphInline = (paragraph: Paragraph, emphasis = true): string =>
    paragraph.runs.map((run) => renderRun(run, emphasis)).join('').trim()

  const renderTable = (table: Extract<Control, { type: 'table' }>): string => {
    // 마크다운 제목 행은 이미 강조돼 있어서, 진한 제목 셀은 — 표를 보통 그렇게
    // 만든다 — `**항목**`으로 렌더링된다.
    const rows = table.rows.map((row, rowIndex) =>
      row.cells.map((cell) =>
        cell.paragraphs
          .map((p) => renderParagraphInline(p, rowIndex > 0))
          .join(' ')
          .replace(/\|/g, '\\|'),
      ),
    )
    if (rows.length === 0) return ''
    const columns = Math.max(...rows.map((r) => r.length))
    const pad = (cells: string[]): string =>
      `| ${Array.from({ length: columns }, (_, i) => cells[i] ?? '').join(' | ')} |`

    const [head, ...body] = rows
    const alignment = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`
    return [pad(head!), alignment, ...body.map(pad)].join('\n')
  }

  const renderParagraph = (paragraph: Paragraph): void => {
    const shape = doc.paraShapes[paragraph.paraShapeId]
    const style = doc.styles[paragraph.styleId]

    // 자기 블록으로 렌더링되는 컨트롤은 스스로 `blocks`에 밀어 넣는다. 그래서
    // 인라인 내용을 먼저 렌더링하고 그다음에야 무엇을 내보낼지 정한다.
    const outlineLevel = headingLevel(style?.name, shape?.headingKind, shape?.headingLevel)

    const before = blocks.length
    // 제목은 이미 수준으로 강조돼 있어서, 그 안의 진하게와 기울임 run은
    // `# **제목**`으로 렌더링된다. 거기서는 표시를 뗀다.
    const text = paragraph.runs.map((run) => renderRun(run, outlineLevel === undefined)).join('')
    const producedBlock = blocks.length > before

    if (text.trim() === '') {
      if (!producedBlock) blocks.push('')
      return
    }

    if (outlineLevel !== undefined) {
      blocks.push(`${'#'.repeat(Math.min(6, outlineLevel))} ${text.trim()}`)
      return
    }

    if (shape?.headingKind === HeadingKind.Bullet) {
      const indent = '  '.repeat(shape.headingLevel ?? 0)
      blocks.push(`${indent}- ${text.trim()}`)
      return
    }
    if (shape?.headingKind === HeadingKind.Number) {
      const indent = '  '.repeat(shape.headingLevel ?? 0)
      blocks.push(`${indent}1. ${text.trim()}`)
      return
    }
    if (shape?.align === Align.Center) {
      blocks.push(`<div align="center">\n\n${text.trim()}\n\n</div>`)
      return
    }

    blocks.push(text.trim())
  }

  if (doc.meta.title) blocks.push(`# ${doc.meta.title}`, '')

  doc.sections.forEach((section, index) => {
    if (index > 0) blocks.push('---')
    for (const paragraph of section.paragraphs) renderParagraph(paragraph)
  })

  if (footnotes.length > 0) blocks.push('', ...footnotes)

  return blocks
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .concat('\n')
}

function headingLevel(
  styleName: string | undefined,
  kind: HeadingKind | undefined,
  level: number | undefined,
): number | undefined {
  if (kind === HeadingKind.Outline) return (level ?? 0) + 1
  const match = styleName && /^(?:개요|Outline)\s*(\d)/.exec(styleName)
  return match ? Number(match[1]) : undefined
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}
