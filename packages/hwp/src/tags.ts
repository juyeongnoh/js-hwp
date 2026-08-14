/**
 * HWP 5.x 레코드 태그 식별자.
 *
 * 문서화된 모든 태그가 `HWPTAG_BEGIN + n`이다. 값은 한컴 포맷 명세의 표
 * 13(DocInfo)과 57(BodyText)을 따른다. 원본 표와 이름이 비슷한 변경 추적 태그
 * 둘에 대한 주석은 `docs/spec/02-record-structure.md`를 보라.
 *
 */

export const HWPTAG_BEGIN = 0x010

/** `DocInfo` 스트림에 나타나는 레코드. */
export enum DocInfoTag {
  DocumentProperties = HWPTAG_BEGIN + 0, // 0x010
  IdMappings = HWPTAG_BEGIN + 1, // 0x011
  BinData = HWPTAG_BEGIN + 2, // 0x012
  FaceName = HWPTAG_BEGIN + 3, // 0x013
  BorderFill = HWPTAG_BEGIN + 4, // 0x014
  CharShape = HWPTAG_BEGIN + 5, // 0x015
  TabDef = HWPTAG_BEGIN + 6, // 0x016
  Numbering = HWPTAG_BEGIN + 7, // 0x017
  Bullet = HWPTAG_BEGIN + 8, // 0x018
  ParaShape = HWPTAG_BEGIN + 9, // 0x019
  Style = HWPTAG_BEGIN + 10, // 0x01A
  DocData = HWPTAG_BEGIN + 11, // 0x01B
  DistributeDocData = HWPTAG_BEGIN + 12, // 0x01C
  CompatibleDocument = HWPTAG_BEGIN + 14, // 0x01E
  LayoutCompatibility = HWPTAG_BEGIN + 15, // 0x01F
  /** 변경 추적 *정보*. 아래 `TrackChange`와 다르다 — 명세 주석 참조. */
  TrackChangeInfo = HWPTAG_BEGIN + 16, // 0x020
  MemoShape = HWPTAG_BEGIN + 76, // 0x05C
  ForbiddenChar = HWPTAG_BEGIN + 78, // 0x05E
  /** 변경 추적 내용 및 모양. */
  TrackChange = HWPTAG_BEGIN + 80, // 0x060
  TrackChangeAuthor = HWPTAG_BEGIN + 81, // 0x061
}

/** `BodyText/Section{N}`과 `ViewText/Section{N}`에 나타나는 레코드. */
export enum SectionTag {
  ParaHeader = HWPTAG_BEGIN + 50, // 0x042
  ParaText = HWPTAG_BEGIN + 51, // 0x043
  ParaCharShape = HWPTAG_BEGIN + 52, // 0x044
  ParaLineSeg = HWPTAG_BEGIN + 53, // 0x045
  ParaRangeTag = HWPTAG_BEGIN + 54, // 0x046
  CtrlHeader = HWPTAG_BEGIN + 55, // 0x047
  ListHeader = HWPTAG_BEGIN + 56, // 0x048
  PageDef = HWPTAG_BEGIN + 57, // 0x049
  FootnoteShape = HWPTAG_BEGIN + 58, // 0x04A
  PageBorderFill = HWPTAG_BEGIN + 59, // 0x04B
  ShapeComponent = HWPTAG_BEGIN + 60, // 0x04C
  Table = HWPTAG_BEGIN + 61, // 0x04D
  ShapeComponentLine = HWPTAG_BEGIN + 62, // 0x04E
  ShapeComponentRectangle = HWPTAG_BEGIN + 63, // 0x04F
  ShapeComponentEllipse = HWPTAG_BEGIN + 64, // 0x050
  ShapeComponentArc = HWPTAG_BEGIN + 65, // 0x051
  ShapeComponentPolygon = HWPTAG_BEGIN + 66, // 0x052
  ShapeComponentCurve = HWPTAG_BEGIN + 67, // 0x053
  ShapeComponentOle = HWPTAG_BEGIN + 68, // 0x054
  ShapeComponentPicture = HWPTAG_BEGIN + 69, // 0x055
  ShapeComponentContainer = HWPTAG_BEGIN + 70, // 0x056
  CtrlData = HWPTAG_BEGIN + 71, // 0x057
  EqEdit = HWPTAG_BEGIN + 72, // 0x058
  ShapeComponentTextArt = HWPTAG_BEGIN + 74, // 0x05A
  FormObject = HWPTAG_BEGIN + 75, // 0x05B
  MemoShape = HWPTAG_BEGIN + 76, // 0x05C
  MemoList = HWPTAG_BEGIN + 77, // 0x05D
  ChartData = HWPTAG_BEGIN + 79, // 0x05F
  VideoData = HWPTAG_BEGIN + 82, // 0x062
  ShapeComponentUnknown = HWPTAG_BEGIN + 99, // 0x073
}

const DOC_INFO_NAMES = new Map<number, string>(
  Object.entries(DocInfoTag)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([name, value]) => [value, name]),
)

const SECTION_NAMES = new Map<number, string>(
  Object.entries(SectionTag)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([name, value]) => [value, name]),
)

/** 진단과 CLI 레코드 덤프를 위한 사람이 읽는 태그 이름. */
export function tagName(tagId: number, stream: 'docinfo' | 'section' = 'section'): string {
  const table = stream === 'docinfo' ? DOC_INFO_NAMES : SECTION_NAMES
  const other = stream === 'docinfo' ? SECTION_NAMES : DOC_INFO_NAMES
  return table.get(tagId) ?? other.get(tagId) ?? `Unknown(0x${tagId.toString(16)})`
}

/**
 * 파일에서 읽히는 그대로의 네 글자 컨트롤 식별자.
 *
 * id는 이름을 거꾸로 적은 바이트로 이뤄진 DWORD를 차지한다. 그래서 리틀
 * 엔디언 DWORD를 읽어 다시 문자로 서식화하는 리더가 `'tbl '`을 복원한다.
 * {@link readCtrlId}가 정확히 그렇게 한다.
 */
export const CtrlId = {
  Table: 'tbl ',
  /** 그리기 개체 껍데기 — 실제 도형은 그 자식 레코드에 있다. */
  DrawingObject: 'gso ',
  Equation: 'eqed',
  SectionDefinition: 'secd',
  ColumnDefinition: 'cold',
  Header: 'head',
  Footer: 'foot',
  Footnote: 'fn  ',
  Endnote: 'en  ',
  /** 자동 번호 (쪽, 각주, 그림 등). */
  AutoNumber: 'atno',
  /** 번호 다시 시작. */
  NewNumber: 'nwno',
  /** 쪽 감추기 컨트롤. */
  PageHiding: 'pghd',
  /** 홀/짝수 쪽 조정. */
  PageOddEven: 'pgct',
  /** 쪽 번호 위치. */
  PageNumberPosition: 'pgnp',
  IndexMark: 'idxm',
  Bookmark: 'bokm',
  /** 겹침 문자. */
  Compose: 'tcps',
  /** 덧말. */
  Dutmal: 'tdut',
  /** 숨은 설명. */
  HiddenComment: 'tcmt',
  /** 필드 컨트롤: 누름틀, 하이퍼링크, 메일 머지, 수식 등. */
  FieldClickHere: '%clk',
  FieldHyperlink: '%hlk',
  FieldMailMerge: '%mmg',
  FieldCrossRef: '%xrf',
  FieldFormula: '%fmu',
  FieldPath: '%pat',
  FieldBookmark: '%bmk',
  FieldSummary: '%smr',
  FieldUserInfo: '%usr',
  FieldDate: '%dte',
  FieldDocDate: '%ddt',
  FieldMemo: '%%me',
  FieldPrivateInfo: '%cpr',
  FieldTableOfContents: '%toc',
} as const

export type CtrlIdValue = (typeof CtrlId)[keyof typeof CtrlId]

/** 페이로드가 개체가 아니라 중첩된 문단 리스트인 컨트롤. */
export const TEXT_CONTAINER_CTRL_IDS = new Set<string>([
  CtrlId.Header,
  CtrlId.Footer,
  CtrlId.Footnote,
  CtrlId.Endnote,
  CtrlId.HiddenComment,
])

/** 텍스트에서 `0x0b`(확장) 제어 문자를 차지하는 컨트롤. */
export const EXTENDED_CTRL_IDS = new Set<string>([CtrlId.Table, CtrlId.DrawingObject, CtrlId.Equation])
