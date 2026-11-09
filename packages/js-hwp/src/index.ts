/**
 * `js-hwp` — 한글 워드프로세서 문서를 읽고, 쓰고, 편집한다.
 *
 * 우산 패키지다. 문서 모델, 빌더, 편집 연산, HWP 코덱을 다시 내보내고, 내용으로
 * 포맷을 판별해서 알아볼 수 없는 파일에 구체적인 오류를 낸다.
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
 * await writeFile('report.hwp', save(doc))
 *
 * // 읽고 수정
 * const existing = open(await readFile('input.hwp'))
 * replaceText(existing, '{{날짜}}', '2026-08-04')
 * await writeFile('output.hwp', save(existing))
 * ```
 *
 * @preserve
 * 본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여
 * 개발하였습니다.
 */

import type { HwpDocument } from '@js-hwp/core'
import { isHwp, parseHwp, serializeHwp, type ParseHwpOptions, type SerializeHwpOptions } from '@js-hwp/hwp'

export * from '@js-hwp/core'
export {
  parseHwp,
  serializeHwp,
  isHwp,
  type ParseHwpOptions,
  type SerializeHwpOptions,
} from '@js-hwp/hwp'

export type DocumentFormat = 'hwp'

export class UnsupportedFormatError extends Error {
  override name = 'UnsupportedFormatError'
}

/**
 * 바이트에서 문서의 포맷을 식별한다.
 *
 * `.hwp`는 `FileHeader`가 HWP 시그니처를 담은 OLE2 복합 파일이다. 파일 이름이
 * 아니라 실제 내용을 보므로, 확장자가 잘못 붙은 파일도 열린다.
 */
export function detectFormat(data: Uint8Array): DocumentFormat | undefined {
  return isHwp(data) ? 'hwp' : undefined
}

export interface OpenOptions extends ParseHwpOptions {
  /** 판별을 건너뛰고 포맷을 강제한다. */
  format?: DocumentFormat
}

/** 문서를 연다. */
export function open(data: Uint8Array, options: OpenOptions = {}): HwpDocument {
  if ((options.format ?? detectFormat(data)) !== 'hwp') {
    throw new UnsupportedFormatError(describeUnknown(data))
  }
  return parseHwp(data, options)
}

export interface SaveOptions extends SerializeHwpOptions {}

/** 문서를 직렬화한다. */
export function save(
  doc: HwpDocument,
  _format: DocumentFormat = 'hwp',
  options: SaveOptions = {},
): Uint8Array {
  return serializeHwp(doc, options)
}

/** 바이트가 이유를 시사할 때는 "지원하지 않는 파일"보다 구체적 메시지가 낫다. */
function describeUnknown(data: Uint8Array): string {
  const head = new TextDecoder('ascii', { fatal: false }).decode(data.subarray(0, 32))

  if (head.startsWith('HWP Document File V3')) {
    return 'This is an HWP 3.x document, which is a different format from HWP 5.x and is not supported. Open it in Hangul and save it as .hwp.'
  }
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
    return 'This is a PDF, not an HWP document.'
  }
  if (data[0] === 0x50 && data[1] === 0x4b) {
    return 'This is a ZIP archive, not an HWP 5.x binary document. If it is an .hwpx package, HWPX is not supported yet.'
  }
  if (data[0] === 0xd0 && data[1] === 0xcf) {
    return 'This is an OLE2 compound file but not an HWP document: its FileHeader stream is missing or does not carry the HWP signature. It may be a .doc or .xls.'
  }
  return 'Unrecognised file: it is not an HWP 5.x binary document.'
}
