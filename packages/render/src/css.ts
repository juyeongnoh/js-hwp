/**
 * HWP 모양을 CSS로 대응시키기.
 *
 * 렌더러가 할 일은 HWP가 정확한 것에 대해서는 충실하고(쪽 기하, 여백, 글꼴
 * 크기, 줄 간격) 브라우저가 한글의 조판을 정확히 재현할 수 없는 곳에서는
 * 우아하게 물러나는 것이다.
 */

import {
  type BorderFill,
  type BorderLine,
  type CharShape,
  FillKind,
  type HwpDocument,
  Lang,
  LineSpacingKind,
  LineStyle,
  LineWidth,
  type ParaShape,
  Align,
  toHex,
  toPt,
  UnderlineKind,
  VerticalAlign,
} from '@js-hwp/core'

/** {@link LineWidth}로 인덱싱한 테두리 굵기, 밀리미터. */
const LINE_WIDTH_MM = [
  0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0,
]

const LINE_STYLE_CSS: Record<number, string> = {
  [LineStyle.None]: 'none',
  [LineStyle.Solid]: 'solid',
  [LineStyle.Dashed]: 'dashed',
  [LineStyle.Dotted]: 'dotted',
  [LineStyle.DashDot]: 'dashed',
  [LineStyle.DashDotDot]: 'dashed',
  [LineStyle.LongDash]: 'dashed',
  [LineStyle.Circle]: 'dotted',
  [LineStyle.DoubleSlim]: 'double',
  [LineStyle.SlimThick]: 'double',
  [LineStyle.ThickSlim]: 'double',
  [LineStyle.SlimThickSlim]: 'double',
}

const ALIGN_CSS: Record<number, string> = {
  [Align.Justify]: 'justify',
  [Align.Left]: 'left',
  [Align.Right]: 'right',
  [Align.Center]: 'center',
  [Align.Distribute]: 'justify',
  [Align.Division]: 'justify',
}

export const VERTICAL_ALIGN_CSS: Record<number, string> = {
  [VerticalAlign.Baseline]: 'baseline',
  [VerticalAlign.Top]: 'top',
  [VerticalAlign.Center]: 'middle',
  [VerticalAlign.Bottom]: 'bottom',
}

/** CSS용으로 숫자를 서식화한다. 뒤의 0은 뗀다. */
export const num = (value: number, digits = 3): string =>
  String(Number(value.toFixed(digits)))

/** HWPUNIT을 CSS `pt` 길이로. */
export const cssPt = (value: number): string => `${num(toPt(value))}pt`

export function borderLineCss(line: BorderLine | undefined): string {
  if (!line || line.style === LineStyle.None) return 'none'
  const width = LINE_WIDTH_MM[line.width] ?? 0.12
  const style = LINE_STYLE_CSS[line.style] ?? 'solid'
  return `${num(width)}mm ${style} ${toHex(line.color)}`
}

/** 테두리/채우기 항목의 CSS 선언. */
export function borderFillCss(fill: BorderFill | undefined): string[] {
  if (!fill) return []
  const out: string[] = [
    `border-left:${borderLineCss(fill.left)}`,
    `border-right:${borderLineCss(fill.right)}`,
    `border-top:${borderLineCss(fill.top)}`,
    `border-bottom:${borderLineCss(fill.bottom)}`,
  ]
  out.push(...fillCss(fill.fill))
  return out
}

export function fillCss(fill: BorderFill['fill'] | undefined): string[] {
  if (!fill) return []
  switch (fill.kind) {
    case FillKind.Color:
      return [`background-color:${toHex(fill.background)}`]
    case FillKind.Gradient: {
      const stops = fill.colors.map((color, i) => {
        const position = fill.stops?.[i]
        return position === undefined ? toHex(color) : `${toHex(color)} ${num(position)}%`
      })
      if (stops.length < 2) return stops.length === 1 ? [`background:${stops[0]}`] : []
      // HWP는 각도를 수평에서 시계방향으로 재고 CSS는 "to top"에서 시계방향으로
      // 잰다. 그래서 90도 차이가 난다.
      return [`background:linear-gradient(${num(fill.angle + 90)}deg, ${stops.join(', ')})`]
    }
    default:
      return []
  }
}

/** 글자 모양의 글꼴 스택. 한글에 친화적인 대체 글꼴 포함. */
export function fontStackCss(doc: HwpDocument, shape: CharShape): string {
  const hangul = doc.fonts[shape.fontIds[Lang.Hangul]]?.name
  const latin = doc.fonts[shape.fontIds[Lang.Latin]]?.name
  const names = [latin, hangul].filter((n): n is string => Boolean(n))
  const quoted = [...new Set(names)].map((n) => `"${n.replace(/"/g, '')}"`)
  quoted.push('"Noto Sans KR"', '"Malgun Gothic"', '"Apple SD Gothic Neo"', 'sans-serif')
  return quoted.join(', ')
}

/** 글자 모양의 CSS 선언. */
export function charShapeCss(doc: HwpDocument, shape: CharShape): string[] {
  const out: string[] = [
    `font-family:${fontStackCss(doc, shape)}`,
    `font-size:${cssPt(shape.height)}`,
    `color:${toHex(shape.textColor)}`,
  ]

  if (shape.bold) out.push('font-weight:700')
  if (shape.italic) out.push('font-style:italic')

  const decorations: string[] = []
  if (shape.underline && shape.underline.kind !== UnderlineKind.None) {
    decorations.push(shape.underline.kind === UnderlineKind.Top ? 'overline' : 'underline')
  }
  if (shape.strikeout && shape.strikeout.kind !== 0) decorations.push('line-through')
  if (decorations.length > 0) {
    out.push(`text-decoration-line:${decorations.join(' ')}`)
    const line = shape.underline
    if (line) {
      out.push(`text-decoration-style:${LINE_STYLE_CSS[line.style] === 'double' ? 'double' : LINE_STYLE_CSS[line.style] ?? 'solid'}`)
      out.push(`text-decoration-color:${toHex(line.color)}`)
    }
  }

  // 0xffffff는 HWP의 "음영 없음"이지 명시적 흰 배경이 아니다.
  if (shape.shadeColor !== 0xffffff && shape.shadeColor !== undefined) {
    out.push(`background-color:${toHex(shape.shadeColor)}`)
  }

  const spacing = shape.spacings[Lang.Hangul]
  if (spacing) out.push(`letter-spacing:${num((spacing / 100) * toPt(shape.height))}pt`)

  const ratio = shape.ratios[Lang.Hangul]
  if (ratio && ratio !== 100) {
    out.push(`display:inline-block`, `transform:scaleX(${num(ratio / 100)})`, 'transform-origin:left')
  }

  if (shape.superscript) out.push('vertical-align:super', 'font-size:0.66em')
  else if (shape.subscript) out.push('vertical-align:sub', 'font-size:0.66em')

  if (shape.outline) {
    out.push(`-webkit-text-stroke:0.3pt ${toHex(shape.textColor)}`, 'color:transparent')
  }
  if (shape.shadow) {
    const { color, offsetX, offsetY } = shape.shadow
    out.push(`text-shadow:${num(offsetX / 10)}pt ${num(offsetY / 10)}pt 0 ${toHex(color)}`)
  }
  if (shape.emboss) out.push('text-shadow:0.5pt 0.5pt 0 rgba(255,255,255,.8), -0.3pt -0.3pt 0 rgba(0,0,0,.4)')
  if (shape.engrave) out.push('text-shadow:-0.5pt -0.5pt 0 rgba(255,255,255,.8), 0.3pt 0.3pt 0 rgba(0,0,0,.4)')

  return out
}

/** 문단 모양의 CSS 선언. */
export function paraShapeCss(shape: ParaShape): string[] {
  const out: string[] = [`text-align:${ALIGN_CSS[shape.align] ?? 'justify'}`]

  if (shape.marginLeft) out.push(`margin-left:${cssPt(shape.marginLeft)}`)
  if (shape.marginRight) out.push(`margin-right:${cssPt(shape.marginRight)}`)
  if (shape.marginTop) out.push(`margin-top:${cssPt(shape.marginTop)}`)
  if (shape.marginBottom) out.push(`margin-bottom:${cssPt(shape.marginBottom)}`)
  if (shape.indent) out.push(`text-indent:${cssPt(shape.indent)}`)

  switch (shape.lineSpacing.kind) {
    case LineSpacingKind.Percent:
      out.push(`line-height:${num(shape.lineSpacing.value / 100)}`)
      break
    case LineSpacingKind.Fixed:
      out.push(`line-height:${cssPt(shape.lineSpacing.value)}`)
      break
    case LineSpacingKind.BetweenLines:
      out.push(`line-height:calc(1em + ${cssPt(shape.lineSpacing.value)})`)
      break
    case LineSpacingKind.AtLeast:
      out.push(`line-height:${num(shape.lineSpacing.value / 100)}`)
      break
  }

  if (shape.keepWithNext) out.push('break-after:avoid')
  if (shape.keepLines) out.push('break-inside:avoid')
  if (shape.pageBreakBefore) out.push('break-before:page')
  if (shape.align === Align.Distribute) out.push('text-align-last:justify')

  // 한글은 기본적으로 한국어 텍스트를 아무 데서나 나누고 라틴 문자는 낱말 경계에서 나눈다.
  out.push('word-break:keep-all', 'overflow-wrap:break-word')

  return out
}

/**
 * 선언 목록을 `style="..."` 속성으로 바꾼다.
 *
 * 값은 그냥 이어 붙이는 게 아니라 HTML 이스케이프해야 한다. 글꼴 스택에는
 * 큰따옴표가 들어 있고(`font-family:"함초롬바탕", …`) 그게 속성을 일찍 닫아
 * 버린다. 증상이 미묘하다. 브라우저가 글꼴 계열 뒤의 모든 선언을 조용히
 * 버려서, 텍스트는 여전히 그려지는데 진하게와 색만 사라진다.
 *
 */
export const styleAttr = (declarations: string[]): string => {
  if (declarations.length === 0) return ''
  const value = declarations
    .join(';')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
  return ` style="${value}"`
}

export { ALIGN_CSS, LINE_WIDTH_MM, LINE_STYLE_CSS }
