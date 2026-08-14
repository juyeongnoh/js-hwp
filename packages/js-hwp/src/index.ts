/**
 * `js-hwp` — 한글 워드프로세서 문서를 읽고, 쓰고, 편집한다.
 *
 * 우산 패키지다. 문서 모델, 빌더, 편집 연산, 두 코덱을 다시 내보내고, 포맷
 * 판별을 더해서 호출자가 파일이 바이너리 `.hwp`인지 XML `.hwpx`인지 신경 쓰지
 * 않아도 되게 한다.
 *
 *
 * ```ts
 * import { open, save, DocumentBuilder, replaceText } from 'js-hwp'
 *
 * // 생성
 * const doc = new DocumentBuilder()
 *   .meta({ title: '분기 보고서' })
 *   .heading(1, '1. 개요')
 *   .paragraph('올해 3분기 실적입니다.')
 *   .table([['항목', '금액'], ['매출', '1,200']], { header: true })
 *   .build()
 * await writeFile('report.hwpx', save(doc, 'hwpx'))
 *
 * // 읽고 수정
 * const existing = open(await readFile('input.hwp'))
 * replaceText(existing, '{{날짜}}', '2026-08-04')
 * await writeFile('output.hwp', save(existing, 'hwp'))
 * ```
 */

import type { HwpDocument } from '@js-hwp/core'
import { isHwp, parseHwp, serializeHwp, type ParseHwpOptions, type SerializeHwpOptions } from '@js-hwp/hwp'
import {
  isHwpx,
  parseHwpx,
  serializeHwpx,
  type ParseHwpxOptions,
  type SerializeHwpxOptions,
} from '@js-hwp/hwpx'

export * from '@js-hwp/core'
export {
  parseHwp,
  serializeHwp,
  isHwp,
  type ParseHwpOptions,
  type SerializeHwpOptions,
} from '@js-hwp/hwp'
export {
  parseHwpx,
  serializeHwpx,
  isHwpx,
  type ParseHwpxOptions,
  type SerializeHwpxOptions,
} from '@js-hwp/hwpx'
export {
  renderToHtml,
  renderBody,
  renderCss,
  renderParagraphHtml,
  renderToMarkdown,
  exportPdf,
  renderPrintableHtml,
  electronBackend,
  browserBackend,
  type RenderOptions,
  type PdfOptions,
  type PdfBackend,
} from '@js-hwp/render'

export type DocumentFormat = 'hwp' | 'hwpx'

export class UnsupportedFormatError extends Error {
  override name = 'UnsupportedFormatError'
}

/**
 * 바이트에서 문서의 포맷을 식별한다.
 *
 * `.hwp`는 `FileHeader`가 HWP 시그니처를 담은 OLE2 복합 파일이고, `.hwpx`는
 * `mimetype`이 `application/hwp+zip`이라고 말하는 ZIP이다. 두 검사 모두 파일
 * 이름이 아니라 실제 내용을 보므로, 확장자가 잘못 붙은 파일도 열린다.
 *
 */
export function detectFormat(data: Uint8Array): DocumentFormat | undefined {
  if (isHwp(data)) return 'hwp'
  if (isHwpx(data)) return 'hwpx'
  return undefined
}

export interface OpenOptions extends ParseHwpOptions, ParseHwpxOptions {
  /** 판별을 건너뛰고 포맷을 강제한다. */
  format?: DocumentFormat
}

/** 문서를 연다. `.hwp`인지 `.hwpx`인지 판별한다. */
export function open(data: Uint8Array, options: OpenOptions = {}): HwpDocument {
  const format = options.format ?? detectFormat(data)
  switch (format) {
    case 'hwp':
      return parseHwp(data, options)
    case 'hwpx':
      return parseHwpx(data, options)
    default:
      throw new UnsupportedFormatError(
        describeUnknown(data),
      )
  }
}

export interface SaveOptions extends SerializeHwpOptions, SerializeHwpxOptions {}

/** 문서를 요청된 포맷으로 직렬화한다. */
export function save(
  doc: HwpDocument,
  format: DocumentFormat = 'hwpx',
  options: SaveOptions = {},
): Uint8Array {
  return format === 'hwp' ? serializeHwp(doc, options) : serializeHwpx(doc, options)
}

/** 파일 이름에서 포맷을 고른다. 기본값은 HWPX. */
export function formatFromPath(path: string): DocumentFormat {
  return /\.hwp$/i.test(path) ? 'hwp' : 'hwpx'
}

/** 파일 시스템을 거치지 않고 두 포맷 사이를 변환한다. */
export function convert(data: Uint8Array, to: DocumentFormat, options: OpenOptions = {}): Uint8Array {
  return save(open(data, options), to)
}

/** 바이트가 이유를 시사할 때는 "지원하지 않는 파일"보다 구체적 메시지가 낫다. */
function describeUnknown(data: Uint8Array): string {
  const head = new TextDecoder('ascii', { fatal: false }).decode(data.subarray(0, 32))

  if (head.startsWith('HWP Document File V3')) {
    return 'This is an HWP 3.x document, which is a different format from HWP 5.x and is not supported. Open it in Hangul and save it as .hwp or .hwpx.'
  }
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
    return 'This is a PDF, not an HWP document.'
  }
  if (data[0] === 0x50 && data[1] === 0x4b) {
    return 'This is a ZIP archive but not an HWPX package: it has no Contents/header.xml. It may be a .docx or .odt.'
  }
  if (data[0] === 0xd0 && data[1] === 0xcf) {
    return 'This is an OLE2 compound file but not an HWP document: its FileHeader stream is missing or does not carry the HWP signature. It may be a .doc or .xls.'
  }
  return 'Unrecognised file: it is neither an HWP 5.x binary document nor an HWPX package.'
}
