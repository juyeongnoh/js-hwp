/**
 * HWPX (OWPML) 상수.
 *
 * 네임스페이스 URI와 패키지 엔트리 이름은 한컴오피스 한글이 직접 만든 파일과,
 * hwpxlib(Apache-2.0)의 상수 표에 대고 확인했다. URI를 하나라도 틀리면 한글이
 * 문서를 거부하므로 정확히 그대로 인용한다.
 *
 */

export const NS = {
  hv: 'http://www.hancom.co.kr/hwpml/2011/version',
  ha: 'http://www.hancom.co.kr/hwpml/2011/app',
  hp: 'http://www.hancom.co.kr/hwpml/2011/paragraph',
  hp10: 'http://www.hancom.co.kr/hwpml/2016/paragraph',
  hs: 'http://www.hancom.co.kr/hwpml/2011/section',
  hc: 'http://www.hancom.co.kr/hwpml/2011/core',
  hh: 'http://www.hancom.co.kr/hwpml/2011/head',
  hhs: 'http://www.hancom.co.kr/hwpml/2011/history',
  hm: 'http://www.hancom.co.kr/hwpml/2011/master-page',
  hpf: 'http://www.hancom.co.kr/schema/2011/hpf',
  dc: 'http://purl.org/dc/elements/1.1/',
  opf: 'http://www.idpf.org/2007/opf/',
  ooxmlchart: 'http://www.hancom.co.kr/hwpml/2016/ooxmlchart',
  hwpunitchar: 'http://www.hancom.co.kr/hwpml/2016/HwpUnitChar',
  epub: 'http://www.idpf.org/2007/ops',
  config: 'urn:oasis:names:tc:opendocument:xmlns:config:1.0',
  ocf: 'urn:oasis:names:tc:opendocument:xmlns:container',
  odf: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
} as const

/**
 * 한글이 `content.hpf`, `header.xml`, 모든 `section*.xml`에 붙이는 네임스페이스
 * 블록. 우리 출력이 한글이 쓴 파일과 깨끗하게 diff되도록 그대로 내보낸다.
 *
 */
export const CONTENT_NAMESPACES: Record<string, string> = {
  'xmlns:ha': NS.ha,
  'xmlns:hp': NS.hp,
  'xmlns:hp10': NS.hp10,
  'xmlns:hs': NS.hs,
  'xmlns:hc': NS.hc,
  'xmlns:hh': NS.hh,
  'xmlns:hhs': NS.hhs,
  'xmlns:hm': NS.hm,
  'xmlns:hpf': NS.hpf,
  'xmlns:dc': NS.dc,
  'xmlns:opf': NS.opf,
  'xmlns:ooxmlchart': NS.ooxmlchart,
  'xmlns:hwpunitchar': NS.hwpunitchar,
  'xmlns:epub': NS.epub,
  'xmlns:config': NS.config,
}

export const ENTRY = {
  mimetype: 'mimetype',
  version: 'version.xml',
  manifest: 'META-INF/manifest.xml',
  container: 'META-INF/container.xml',
  contentHpf: 'Contents/content.hpf',
  header: 'Contents/header.xml',
  settings: 'settings.xml',
  previewText: 'Preview/PrvText.txt',
  previewImage: 'Preview/PrvImage.png',
} as const

export const MIMETYPE = 'application/hwp+zip'
export const PACKAGE_MEDIA_TYPE = 'application/hwpml-package+xml'

export const sectionEntry = (index: number): string => `Contents/section${index}.xml`
export const binDataEntry = (name: string): string => `BinData/${name}`

// ---------------------------------------------------------------------------
// 열거된 속성 값
// ---------------------------------------------------------------------------

/**
 * 용지 방향.
 *
 * 이름이 뜻하는 바와 반대다. `WIDELY`가 세로이고 `NARROWLY`가 가로다. 한글이
 * 쓴 빈 문서로 확인했다. 그건 A4 세로인데 `WIDELY`라고 적혀 있다.
 *
 */
export const PAGE_DIRECTION = {
  portrait: 'WIDELY',
  landscape: 'NARROWLY',
} as const

export const HORIZONTAL_ALIGN = ['JUSTIFY', 'LEFT', 'RIGHT', 'CENTER', 'DISTRIBUTE', 'DIVISION'] as const
export const VERTICAL_ALIGN = ['BASELINE', 'TOP', 'CENTER', 'BOTTOM'] as const

export const LINE_SPACING_TYPE = ['PERCENT', 'FIXED', 'BETWEEN_LINES', 'AT_LEAST'] as const

export const LINE_TYPE = [
  'NONE',
  'SOLID',
  'DASH',
  'DOT',
  'DASH_DOT',
  'DASH_DOT_DOT',
  'LONG_DASH',
  'CIRCLE',
  'DOUBLE_SLIM',
  'SLIM_THICK',
  'THICK_SLIM',
  'SLIM_THICK_SLIM',
] as const

export const LINE_WIDTH = [
  '0.1 mm',
  '0.12 mm',
  '0.15 mm',
  '0.2 mm',
  '0.25 mm',
  '0.3 mm',
  '0.4 mm',
  '0.5 mm',
  '0.6 mm',
  '0.7 mm',
  '1.0 mm',
  '1.5 mm',
  '2.0 mm',
  '3.0 mm',
  '4.0 mm',
  '5.0 mm',
] as const

export const UNDERLINE_TYPE = ['NONE', 'BOTTOM', 'CENTER', 'TOP'] as const

/**
 * 모델의 `PageBreakInTable`로 인덱싱한 표 쪽 나눔 동작.
 *
 * HWPX와 바이너리 포맷이 이걸 반대 순서로 놓는다. HWPX는
 * `TABLE(0) CELL(1) NONE(2)`인데 바이너리 포맷은 `none(0) cell(1) split(2)`다.
 * 서수로 대응시키면 표가 쪽 경계를 넘어 나뉠 수 있는지가 조용히 뒤집힌다.
 * 그래서 이 표가 존재해서 대응을 이름으로 가게 강제한다.
 *
 */
export const TABLE_PAGE_BREAK = ['NONE', 'CELL', 'TABLE'] as const

/**
 * 모델의 `VerticalAlign`으로 인덱싱한 셀 세로 정렬.
 *
 * 모델의 열거형은 셀에 없는 `Baseline`에서 시작한다. 바이너리 포맷과 HWPX 둘 다
 * 위/가운데/아래만 쓴다. 그래서 `Baseline`은 `TOP`으로 쓰이고, 파일의 인덱스
 * 0은 `Top`으로 되읽힌다.
 */
export const CELL_VERTICAL_ALIGN = ['TOP', 'TOP', 'CENTER', 'BOTTOM'] as const

/** 파일의 값(0=위, 1=가운데, 2=아래)을 모델의 `VerticalAlign`으로. */
export const CELL_VERTICAL_ALIGN_FROM_WIRE = [1, 2, 3] as const

export const HEADING_TYPE = ['NONE', 'OUTLINE', 'NUMBER', 'BULLET'] as const

export const LANG_ATTRS = ['hangul', 'latin', 'hanja', 'japanese', 'other', 'symbol', 'user'] as const

/** `hh:fontface`가 이 이름들로 글꼴을 문자 체계별로 묶는다. */
export const FONT_FACE_LANGS = [
  'HANGUL',
  'LATIN',
  'HANJA',
  'JAPANESE',
  'OTHER',
  'SYMBOL',
  'USER',
] as const

export const NUMBER_FORMAT_NAMES: Record<number, string> = {
  0: 'DIGIT',
  1: 'CIRCLED_DIGIT',
  2: 'ROMAN_CAPITAL',
  3: 'ROMAN_SMALL',
  4: 'LATIN_CAPITAL',
  5: 'LATIN_SMALL',
  6: 'CIRCLED_LATIN_CAPITAL',
  7: 'CIRCLED_LATIN_SMALL',
  8: 'HANGUL_SYLLABLE',
  9: 'CIRCLED_HANGUL_SYLLABLE',
  10: 'HANGUL_JAMO',
  11: 'CIRCLED_HANGUL_JAMO',
  12: 'HANGUL_PHONETIC',
  13: 'IDEOGRAPH',
  14: 'CIRCLED_IDEOGRAPH',
  15: 'DECAGON_CIRCLE',
  16: 'DECAGON_CIRCLE_HANJA',
}

/** HWPX 이름으로 열거형 인덱스를 찾는다. 없으면 0으로 물러난다. */
export function enumIndex(table: readonly string[], value: string | undefined, fallback = 0): number {
  if (value === undefined) return fallback
  const index = table.indexOf(value)
  return index === -1 ? fallback : index
}

export const enumName = (table: readonly string[], index: number, fallback: string): string =>
  table[index] ?? fallback

/** HWPX용 `#rrggbb`, 또는 HWPX가 "색 없음"에 쓰는 리터럴 `none`. */
export function colorAttr(value: number | undefined): string {
  if (value === undefined) return 'none'
  return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`
}

export function parseColorAttr(value: string | undefined, fallback = 0): number {
  if (!value || value === 'none') return fallback
  const hex = value.startsWith('#') ? value.slice(1) : value
  const parsed = parseInt(hex, 16)
  return Number.isNaN(parsed) ? fallback : parsed & 0xffffff
}

/** 선 굵기는 `"0.12 mm"`로 쓰인다. 다시 열거형 인덱스로 대응시킨다. */
export function lineWidthIndex(value: string | undefined): number {
  if (!value) return 1
  const index = LINE_WIDTH.indexOf(value as (typeof LINE_WIDTH)[number])
  if (index !== -1) return index
  // "0.12mm" 같은 공백 차이도 견딘다.
  const normalized = value.replace(/\s+/g, '')
  const found = LINE_WIDTH.findIndex((w) => w.replace(/\s+/g, '') === normalized)
  return found === -1 ? 1 : found
}
