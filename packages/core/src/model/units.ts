/**
 * HWP 측정 단위.
 *
 * HWP 포맷의 네이티브 단위는 HWPUNIT이고 1/7200 인치다. 포인트당 정확히
 * 100단위이므로(1pt = 1/72 인치) 대부분의 환산이 정확한 정수 산술이 된다.
 *
 */

/** HWPUNIT(1/7200 인치) 길이. 항상 정수다. */
export type HwpUnit = number

/** 부호 있는 HWPUNIT 길이. */
export type SHwpUnit = number

export const HWPUNIT_PER_INCH = 7200
export const HWPUNIT_PER_POINT = 100
/** 1 인치 = 25.4mm이므로 7200 / 25.4 */
export const HWPUNIT_PER_MM = HWPUNIT_PER_INCH / 25.4

export const inch = (value: number): HwpUnit => Math.round(value * HWPUNIT_PER_INCH)
export const pt = (value: number): HwpUnit => Math.round(value * HWPUNIT_PER_POINT)
export const mm = (value: number): HwpUnit => Math.round(value * HWPUNIT_PER_MM)
export const cm = (value: number): HwpUnit => mm(value * 10)
/** 관례적인 96dpi 기준 CSS 픽셀. */
export const px = (value: number): HwpUnit => Math.round((value * HWPUNIT_PER_INCH) / 96)

export const toInch = (value: HwpUnit): number => value / HWPUNIT_PER_INCH
export const toPt = (value: HwpUnit): number => value / HWPUNIT_PER_POINT
export const toMm = (value: HwpUnit): number => value / HWPUNIT_PER_MM
export const toCm = (value: HwpUnit): number => toMm(value) / 10
export const toPx = (value: HwpUnit): number => (value * 96) / HWPUNIT_PER_INCH

/**
 * CSS 비슷한 길이 문자열을 HWPUNIT으로 파싱한다.
 * `12pt`, `2.5cm`, `10mm`, `1in`, `96px`, 또는 맨 숫자(HWPUNIT)를 받는다.
 */
export function parseLength(value: string | number): HwpUnit {
  if (typeof value === 'number') return Math.round(value)
  const match = /^\s*(-?[\d.]+)\s*(pt|cm|mm|in|px|hwp)?\s*$/i.exec(value)
  if (!match) throw new TypeError(`Cannot parse length: ${value}`)
  const n = Number(match[1])
  switch ((match[2] ?? 'hwp').toLowerCase()) {
    case 'pt':
      return pt(n)
    case 'cm':
      return cm(n)
    case 'mm':
      return mm(n)
    case 'in':
      return inch(n)
    case 'px':
      return px(n)
    default:
      return Math.round(n)
  }
}

/** 흔한 용지 크기. HWPUNIT, 세로 방향. */
export const PAPER = {
  A4: { width: mm(210), height: mm(297) },
  A3: { width: mm(297), height: mm(420) },
  A5: { width: mm(148), height: mm(210) },
  B4: { width: mm(257), height: mm(364) },
  B5: { width: mm(182), height: mm(257) },
  LETTER: { width: inch(8.5), height: inch(11) },
  LEGAL: { width: inch(8.5), height: inch(14) },
} as const satisfies Record<string, { width: HwpUnit; height: HwpUnit }>

export type PaperSizeName = keyof typeof PAPER
