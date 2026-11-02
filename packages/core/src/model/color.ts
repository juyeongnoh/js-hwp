/**
 * 색.
 *
 * 모델에서 색은 r, g, b 성분과 unknown을 담은 객체다. 그래서 애플리케이션 코드가
 * 디스크상 바이트 순서를 생각할 일이 없다. HWP 바이너리 포맷은 COLORREF를
 * R, G, B, 최상위 순서의 4바이트로 저장하고 코덱이 경계에서 변환한다. HWPX는
 * `#RRGGBB` 문자열을 저장하고 변환이 자명하다.
 */

export interface Rgb {
  r: number
  g: number
  b: number
  /**
   * COLORREF의 최상위 바이트. 의미를 모른다. 색을 해석할 때는 쓰지 않고, 왕복
   * 보존용으로 원시 값만 담는다. 확인된 것은 {@link NO_COLOR} 참조.
   */
  unknown: number
}

/**
 * 파일 바이트 `FF FF FF FF`. 한글에서 "색 없음"이다. 흰색은 `FF FF FF 00`이다.
 * 셀 배경에서 확인했다. 다른 필드와 다른 최상위 값은 확인되지 않았다.
 */
export const NO_COLOR: Readonly<Rgb> = Object.freeze({ r: 0xff, g: 0xff, b: 0xff, unknown: 0xff })

export const rgb = (r: number, g: number, b: number, unknown = 0): Rgb => ({
  r: clamp255(r),
  g: clamp255(g),
  b: clamp255(b),
  unknown,
})

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))

/** 색 -> `#rrggbb`. unknown은 무시한다. */
export const toHex = (c: Rgb): string =>
  `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** `0xRRGGBB`, `#rgb`, `#rrggbb`, `rgb(r,g,b)` 또는 이름 있는 색 -> 색 */
export function parseColor(value: string | number): Rgb {
  if (typeof value === 'number') return rgb((value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
  const v = value.trim().toLowerCase()

  const named = NAMED_COLORS[v]
  if (named !== undefined) return parseColor(named)

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v)
  if (short) {
    return rgb(
      parseInt(short[1]! + short[1]!, 16),
      parseInt(short[2]! + short[2]!, 16),
      parseInt(short[3]! + short[3]!, 16),
    )
  }

  const long = /^#([0-9a-f]{6})$/.exec(v)
  if (long) return parseColor(parseInt(long[1]!, 16))

  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(v)
  if (fn) return rgb(Number(fn[1]), Number(fn[2]), Number(fn[3]))

  throw new TypeError(`Cannot parse color: ${value}`)
}

const NAMED_COLORS: Record<string, number> = {
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
