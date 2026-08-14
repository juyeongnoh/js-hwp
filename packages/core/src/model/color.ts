/**
 * 색.
 *
 * 모델에서 색은 항상 24비트 RGB 정수(0xRRGGBB)로 저장한다. 그래서 애플리케이션
 * 코드가 디스크상 바이트 순서를 생각할 일이 없다. HWP 바이너리 포맷은 COLORREF를
 * 0x00BBGGRR(리틀 엔디언 DWORD)로 저장하고 코덱이 경계에서 변환한다. HWPX는
 * `#RRGGBB` 문자열을 저장하고 변환이 자명하다.
 *
 */

/** 24비트 RGB, `0xRRGGBB`. */
export type Rgb = number

/** 채우기와 테두리 칸에서 HWP가 "색 없음 / 투명"에 쓰는 표지값. */
export const NO_COLOR = 0xffffffff

export const rgb = (r: number, g: number, b: number): Rgb =>
  ((clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)) >>> 0

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))

export const red = (c: Rgb): number => (c >>> 16) & 0xff
export const green = (c: Rgb): number => (c >>> 8) & 0xff
export const blue = (c: Rgb): number => c & 0xff

/** `0xRRGGBB` -> `#rrggbb` */
export const toHex = (c: Rgb): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`

/** `#rgb`, `#rrggbb`, `rgb(r,g,b)` 또는 이름 있는 색 -> `0xRRGGBB` */
export function parseColor(value: string | number): Rgb {
  if (typeof value === 'number') return value >>> 0
  const v = value.trim().toLowerCase()

  const named = NAMED_COLORS[v]
  if (named !== undefined) return named

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v)
  if (short) {
    return rgb(
      parseInt(short[1]! + short[1]!, 16),
      parseInt(short[2]! + short[2]!, 16),
      parseInt(short[3]! + short[3]!, 16),
    )
  }

  const long = /^#([0-9a-f]{6})$/.exec(v)
  if (long) return parseInt(long[1]!, 16) >>> 0

  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(v)
  if (fn) return rgb(Number(fn[1]), Number(fn[2]), Number(fn[3]))

  throw new TypeError(`Cannot parse color: ${value}`)
}

const NAMED_COLORS: Record<string, Rgb> = {
  black: 0x000000,
  white: 0xffffff,
  red: 0xff0000,
  green: 0x008000,
  lime: 0x00ff00,
  blue: 0x0000ff,
  yellow: 0xffff00,
  cyan: 0x00ffff,
  magenta: 0xff00ff,
  gray: 0x808080,
  grey: 0x808080,
  silver: 0xc0c0c0,
  maroon: 0x800000,
  olive: 0x808000,
  navy: 0x000080,
  purple: 0x800080,
  teal: 0x008080,
  orange: 0xffa500,
}
