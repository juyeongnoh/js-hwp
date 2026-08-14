/**
 * `@js-hwp/hwp` — HWP 5.x 바이너리 문서를 읽고 쓴다.
 *
 * `.hwp` 파일은 `FileHeader`, 공유 자원의 `DocInfo` 레코드 스트림, 그리고 구역
 * 하나당 레코드 스트림 하나를 담은 OLE2 복합 파일이다. 이 패키지는 그 계층들을
 * `@js-hwp/cfb` 위에 구현한다.
 */

export { parseHwp, serializeHwp, isHwp, type ParseHwpOptions, type SerializeHwpOptions } from './document.js'
export {
  parseFileHeader,
  serializeFileHeader,
  createFileHeader,
  formatVersion,
  DEFAULT_FLAGS,
  FILE_HEADER_SIZE,
  SIGNATURE,
  type FileHeader,
  type HwpFlags,
  type LicenseFlags,
} from './fileheader.js'
export { parseDocInfo, serializeDocInfo, ID_MAPPING_SLOTS, type IdMappingCounts } from './docinfo.js'
export {
  parseSection,
  serializeSection,
  readCtrlId,
  writeCtrlId,
  CONTROL_FORM,
} from './bodytext.js'
export {
  parseRecords,
  serializeRecords,
  buildRecordTree,
  flattenRecordTree,
  RecordWriter,
  type HwpRecord,
  type RecordNode,
} from './record.js'
export { inflate, deflate, maybeInflate, maybeDeflate } from './compress.js'
export { ByteReader, ByteWriter, HwpFormatError, bit, bits, setBit, setBits } from './bytes.js'
export { DocInfoTag, SectionTag, CtrlId, HWPTAG_BEGIN, tagName } from './tags.js'
