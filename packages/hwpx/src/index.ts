/**
 * `@js-hwp/hwpx` — HWPX(OWPML, KS X 6101) 문서를 읽고 쓴다.
 *
 * HWPX는 한글 문서 포맷의 개방된 ZIP + XML 형태이고, 문서를 생성할 때 선호할
 * 대상이다. 완전히 규정돼 있고, 우리가 내보낸 것을 한글이 쓴 것과 바로 diff할
 * 수 있다.
 *
 * 본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여
 * 개발하였습니다.
 */

export { parseHwpx, isHwpx, HwpxError, type ParseHwpxOptions } from './parse.js'
export { serializeHwpx, type SerializeHwpxOptions } from './serialize.js'
export * from './constants.js'
export {
  parseXml,
  serializeXml,
  el,
  attr,
  numAttr,
  boolAttr,
  child,
  children,
  descendants,
  path,
  textContent,
  escapeXml,
  XmlError,
  type XmlElement,
  type XmlNode,
} from './xml.js'
