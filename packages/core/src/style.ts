/**
 * 친절한 스타일 서술과, 그것이 HWP 모양으로 바뀌는 방식.
 *
 * 애플리케이션 코드는 `{ bold: true, size: 12, color: 'red' }`라고 쓴다.
 * 여기 있는 함수들이 그걸 기존 {@link CharShape}나 {@link ParaShape} 위에
 * 접어 넣어서, 결과를 문서의 자원 표에 인터닝할 수 있게 만든다.
 *
 */

import { parseColor } from './model/color.js'
import {
  Align,
  type CharShape,
  Lang,
  LANG_COUNT,
  LineSpacingKind,
  LineStyle,
  type ParaShape,
  type PerLang,
  StrikeoutKind,
  UnderlineKind,
  VerticalAlign,
} from './model/docinfo.js'
import { type HwpUnit, parseLength, pt } from './model/units.js'
import type { Resources } from './resources.js'

export type AlignName = 'left' | 'center' | 'right' | 'justify' | 'distribute' | 'division'

const ALIGNS: Record<AlignName, Align> = {
  justify: Align.Justify,
  left: Align.Left,
  right: Align.Right,
  center: Align.Center,
  distribute: Align.Distribute,
  division: Align.Division,
}

export type VerticalAlignName = 'baseline' | 'top' | 'center' | 'bottom'

const VERTICAL_ALIGNS: Record<VerticalAlignName, VerticalAlign> = {
  baseline: VerticalAlign.Baseline,
  top: VerticalAlign.Top,
  center: VerticalAlign.Center,
  bottom: VerticalAlign.Bottom,
}

export type UnderlineStyleName =
  | 'solid'
  | 'dashed'
  | 'dotted'
  | 'dashDot'
  | 'dashDotDot'
  | 'longDash'
  | 'double'

const UNDERLINE_STYLES: Record<UnderlineStyleName, LineStyle> = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
  dashDot: LineStyle.DashDot,
  dashDotDot: LineStyle.DashDotDot,
  longDash: LineStyle.LongDash,
  double: LineStyle.DoubleSlim,
}

/** 애플리케이션 코드가 표현하기 좋아하는 방식의 글자 서식. */
export interface TextStyle {
  /** 글꼴 계열. {@link fonts}가 재정의하지 않으면 모든 문자 체계에 적용된다. */
  font?: string
  /** 문자 체계별 글꼴. 한글과 라틴 서체를 섞는 문서용. */
  fonts?: Partial<Record<'hangul' | 'latin' | 'hanja' | 'japanese' | 'other' | 'symbol' | 'user', string>>
  /** 글꼴 크기: 포인트 숫자, 또는 `'10.5pt'` 같은 길이 문자열. */
  size?: number | string
  bold?: boolean
  italic?: boolean
  underline?: boolean | { style?: UnderlineStyleName; color?: string | number; position?: 'top' | 'bottom' }
  strikeout?: boolean | { color?: string | number }
  outline?: boolean
  shadow?: boolean
  emboss?: boolean
  engrave?: boolean
  superscript?: boolean
  subscript?: boolean
  /** 글자 색. */
  color?: string | number
  /** 배경(형광) 색. */
  highlight?: string | number
  /** 자간. 글자 폭에 대한 퍼센트 (-50..50). */
  letterSpacing?: number
  /** 장평, 퍼센트 (50..200). */
  stretch?: number
  /** 기준선 이동, 퍼센트 (-100..100). */
  offset?: number
}

const LANG_INDEX = {
  hangul: Lang.Hangul,
  latin: Lang.Latin,
  hanja: Lang.Hanja,
  japanese: Lang.Japanese,
  other: Lang.Other,
  symbol: Lang.Symbol,
  user: Lang.User,
} as const

const fillPerLang = <T>(base: PerLang<T>, value: T): PerLang<T> => {
  const out = [...base] as PerLang<T>
  for (let i = 0; i < LANG_COUNT; i++) out[i] = value
  return out
}

/** {@link TextStyle}을 글자 모양 위에 접어 넣는다. */
export function applyTextStyle(base: CharShape, style: TextStyle, resources: Resources): CharShape {
  const shape: CharShape = {
    ...base,
    fontIds: [...base.fontIds] as PerLang<number>,
    ratios: [...base.ratios] as PerLang<number>,
    spacings: [...base.spacings] as PerLang<number>,
    relSizes: [...base.relSizes] as PerLang<number>,
    offsets: [...base.offsets] as PerLang<number>,
  }

  if (style.font !== undefined) {
    shape.fontIds = fillPerLang(shape.fontIds, resources.font(style.font))
  }
  if (style.fonts) {
    for (const [name, family] of Object.entries(style.fonts)) {
      if (family === undefined) continue
      shape.fontIds[LANG_INDEX[name as keyof typeof LANG_INDEX]] = resources.font(family)
    }
  }
  if (style.size !== undefined) {
    shape.height = typeof style.size === 'number' ? pt(style.size) : parseLength(style.size)
  }
  if (style.bold !== undefined) shape.bold = style.bold
  if (style.italic !== undefined) shape.italic = style.italic
  if (style.outline !== undefined) shape.outline = style.outline ? 1 : 0
  if (style.emboss !== undefined) shape.emboss = style.emboss
  if (style.engrave !== undefined) shape.engrave = style.engrave
  if (style.superscript !== undefined) {
    shape.superscript = style.superscript
    if (style.superscript) shape.subscript = false
  }
  if (style.subscript !== undefined) {
    shape.subscript = style.subscript
    if (style.subscript) shape.superscript = false
  }

  if (style.underline !== undefined) {
    if (style.underline === false) {
      delete shape.underline
    } else {
      const spec = style.underline === true ? {} : style.underline
      shape.underline = {
        kind: spec.position === 'top' ? UnderlineKind.Top : UnderlineKind.Bottom,
        style: UNDERLINE_STYLES[spec.style ?? 'solid'],
        color: spec.color !== undefined ? parseColor(spec.color) : shape.textColor,
      }
    }
  }

  if (style.strikeout !== undefined) {
    if (style.strikeout === false) {
      delete shape.strikeout
    } else {
      const spec = style.strikeout === true ? {} : style.strikeout
      shape.strikeout = {
        kind: StrikeoutKind.Continuous,
        style: LineStyle.Solid,
        color: spec.color !== undefined ? parseColor(spec.color) : shape.textColor,
      }
    }
  }

  if (style.shadow !== undefined) {
    shape.shadow = style.shadow
      ? { kind: 1, color: 0x808080, offsetX: 10, offsetY: 10 }
      : undefined
    if (!style.shadow) delete shape.shadow
  }

  if (style.color !== undefined) shape.textColor = parseColor(style.color)
  if (style.highlight !== undefined) shape.shadeColor = parseColor(style.highlight)
  if (style.letterSpacing !== undefined) {
    shape.spacings = fillPerLang(shape.spacings, style.letterSpacing)
  }
  if (style.stretch !== undefined) shape.ratios = fillPerLang(shape.ratios, style.stretch)
  if (style.offset !== undefined) shape.offsets = fillPerLang(shape.offsets, style.offset)

  return shape
}

/** 애플리케이션 코드가 표현하기 좋아하는 방식의 문단 서식. */
export interface ParagraphStyle {
  align?: AlignName
  /** 퍼센트로 나타낸 줄 간격 (한글 기본값은 160). */
  lineHeight?: number
  /** 고정 줄 높이. {@link lineHeight}를 재정의한다. */
  lineHeightFixed?: number | string
  /** 문단 위 간격. */
  spaceBefore?: number | string
  /** 문단 아래 간격. */
  spaceAfter?: number | string
  /** 왼쪽과 오른쪽 들여쓰기. */
  marginLeft?: number | string
  marginRight?: number | string
  /** 첫 줄 들여쓰기. 음수면 내어쓰기가 된다. */
  indent?: number | string
  keepWithNext?: boolean
  keepLines?: boolean
  pageBreakBefore?: boolean
  widowOrphan?: boolean
  verticalAlign?: VerticalAlignName
  /** 테두리를 두른 문단을 위한 문서 테두리/채우기 표의 인덱스. */
  borderFillId?: number
}

const length = (value: number | string | undefined): HwpUnit | undefined =>
  value === undefined ? undefined : typeof value === 'number' ? pt(value) : parseLength(value)

/** {@link ParagraphStyle}을 문단 모양 위에 접어 넣는다. */
export function applyParagraphStyle(base: ParaShape, style: ParagraphStyle): ParaShape {
  const shape: ParaShape = { ...base, lineSpacing: { ...base.lineSpacing } }

  if (style.align !== undefined) shape.align = ALIGNS[style.align]
  if (style.lineHeight !== undefined) {
    shape.lineSpacing = { kind: LineSpacingKind.Percent, value: style.lineHeight }
  }
  if (style.lineHeightFixed !== undefined) {
    shape.lineSpacing = { kind: LineSpacingKind.Fixed, value: length(style.lineHeightFixed)! }
  }

  const before = length(style.spaceBefore)
  if (before !== undefined) shape.marginTop = before
  const after = length(style.spaceAfter)
  if (after !== undefined) shape.marginBottom = after
  const left = length(style.marginLeft)
  if (left !== undefined) shape.marginLeft = left
  const right = length(style.marginRight)
  if (right !== undefined) shape.marginRight = right
  const indent = length(style.indent)
  if (indent !== undefined) shape.indent = indent

  if (style.keepWithNext !== undefined) shape.keepWithNext = style.keepWithNext
  if (style.keepLines !== undefined) shape.keepLines = style.keepLines
  if (style.pageBreakBefore !== undefined) shape.pageBreakBefore = style.pageBreakBefore
  if (style.widowOrphan !== undefined) shape.widowOrphan = style.widowOrphan
  if (style.verticalAlign !== undefined) {
    shape.verticalAlign = VERTICAL_ALIGNS[style.verticalAlign]
  }
  if (style.borderFillId !== undefined) {
    shape.border = {
      offsetLeft: 0,
      offsetRight: 0,
      offsetTop: 0,
      offsetBottom: 0,
      ...shape.border,
      borderFillId: style.borderFillId,
    }
  }

  return shape
}

export { ALIGNS, VERTICAL_ALIGNS, UNDERLINE_STYLES }
