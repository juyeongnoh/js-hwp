/**
 * 컨트롤 — HWP 문서에서 평문이 아닌 모든 것.
 *
 * 바이너리 포맷에서 컨트롤은 문단 텍스트 안의 제어 문자에 더해, 네 글자 id
 * (`tbl `, `gso `, `secd`, …)로 식별되는 `CTRL_HEADER` 레코드다. HWPX에서는
 * 같은 것들이 `<hp:run>` 안의 요소다. 이 모듈은 그것들을 나타나는 run에
 * 고정시켜 균일하게 모델링한다.
 */

import type { Rgb } from './color.js'
import type { BorderLine, Fill, ImageEffect, LineStyle, NumberFormat, VerticalAlign } from './docinfo.js'
import type { HwpUnit, SHwpUnit } from './units.js'

// ---------------------------------------------------------------------------
// 떠 있는 개체의 배치
// ---------------------------------------------------------------------------

/** 떠 있는 개체의 위치를 무엇에 대해 재는지. */
export enum RelativeTo {
  Paper = 0,
  Page = 1,
  Column = 2,
  Paragraph = 3,
}

export enum HorzAlign {
  Left = 0,
  Center = 1,
  Right = 2,
  Inside = 3,
  Outside = 4,
}

export enum VertAlign {
  Top = 0,
  Center = 1,
  Bottom = 2,
  Inside = 3,
  Outside = 4,
}

/** 떠 있는 개체 주위로 텍스트가 어떻게 흐르는지. */
export enum TextWrap {
  Square = 0,
  Tight = 1,
  Through = 2,
  TopAndBottom = 3,
  BehindText = 4,
  InFrontOfText = 5,
}

export enum TextFlowSide {
  Both = 0,
  Left = 1,
  Right = 2,
  Largest = 3,
}

export enum WidthCriterion {
  Paper = 0,
  Page = 1,
  Column = 2,
  Paragraph = 3,
  Absolute = 4,
}

export enum HeightCriterion {
  Paper = 0,
  Page = 1,
  Absolute = 2,
}

export enum CaptionSide {
  Left = 0,
  Right = 1,
  Top = 2,
  Bottom = 3,
}

export interface Caption {
  side: CaptionSide
  /** 캡션 폭에 개체의 여백을 포함한다. */
  fullSize?: boolean
  width: HwpUnit
  /** 캡션과 개체 사이 간격. */
  gap: HwpUnit
  maxWidth?: HwpUnit
  paragraphs: Paragraph[]
}

/**
 * 텍스트 안에 떠 있을 수 있는 모든 개체(표, 이미지, 그리기 개체, 수식 등)가
 * 공유하는 속성.
 */
export interface ObjectPlacement {
  /** 개체를 큰 글자 하나처럼 줄 안에 배치한다. */
  treatAsChar?: boolean
  /** {@link treatAsChar}일 때 개체가 줄 높이를 밀어 올리게 한다. */
  affectLineSpacing?: boolean

  vertRelTo: RelativeTo
  vertAlign?: VertAlign
  horzRelTo: RelativeTo
  horzAlign?: HorzAlign
  /** 개체를 앵커 문단과 같은 쪽에 유지한다. */
  flowWithText?: boolean
  allowOverlap?: boolean

  offsetX: SHwpUnit
  offsetY: SHwpUnit
  width: HwpUnit
  height: HwpUnit
  widthCriterion?: WidthCriterion
  heightCriterion?: HeightCriterion

  /** 떠 있는 개체들 사이의 쌓임 순서. */
  zOrder?: number
  textWrap?: TextWrap
  textFlowSide?: TextFlowSide

  marginLeft?: HwpUnit
  marginRight?: HwpUnit
  marginTop?: HwpUnit
  marginBottom?: HwpUnit

  /** 개체가 쪽 경계를 넘어 나뉘도록 허용한다. */
  allowPageSplit?: boolean
  /** 편집으로부터 보호한다. */
  locked?: boolean

  caption?: Caption
  /** 대체 텍스트 / 설명. 접근성과 HWPX가 쓴다. */
  description?: string
  name?: string
  instanceId?: number
}

export const DEFAULT_PLACEMENT: ObjectPlacement = {
  treatAsChar: true,
  vertRelTo: RelativeTo.Paragraph,
  horzRelTo: RelativeTo.Column,
  offsetX: 0,
  offsetY: 0,
  width: 0,
  height: 0,
}

// ---------------------------------------------------------------------------
// 표
// ---------------------------------------------------------------------------

export enum PageBreakInTable {
  None = 0,
  /** 표는 나누되 각 셀은 온전히 유지한다. */
  Cell = 1,
  /** 개별 셀도 나눈다. */
  Split = 2,
}

export interface CellMargins {
  left: HwpUnit
  right: HwpUnit
  top: HwpUnit
  bottom: HwpUnit
}

export interface TableCell {
  /** 0부터 시작하는 격자 위치. */
  col: number
  row: number
  colSpan: number
  rowSpan: number
  width: HwpUnit
  height: HwpUnit
  margins?: CellMargins
  /** {@link HwpDocument.borderFills}의 인덱스. */
  borderFillId?: number
  verticalAlign?: VerticalAlign
  /** 셀에 맞게 텍스트를 줄인다. */
  shrinkToFit?: boolean
  /** 셀 안에서 줄바꿈을 막는다. */
  noWrap?: boolean
  /** 쪽마다 반복되는 제목 행으로 취급한다. */
  header?: boolean
  /** 셀 본문. 셀은 항상 문단을 최소 하나 담는다. */
  paragraphs: Paragraph[]
  /** 계산되는 셀일 때의 `=SUM(ABOVE)` 형태 수식. */
  formula?: string
}

export interface TableRow {
  cells: TableCell[]
  /** 명시적 행 높이. 없으면 내용에서 유도한다. */
  height?: HwpUnit
}

export interface TableControl {
  type: 'table'
  placement: ObjectPlacement
  rows: TableRow[]
  /** 균일한 안쪽 여백. 셀별로 재정의할 수 있다. */
  cellMargins: CellMargins
  cellSpacing?: HwpUnit
  borderFillId?: number
  pageBreak?: PageBreakInTable
  /** 앞의 N개 행을 쪽마다 제목으로 반복한다. */
  repeatHeaderRows?: number
  /** 왕복을 위해 기록해두는 자동 맞춤 동작. */
  noAdjust?: boolean
}

// ---------------------------------------------------------------------------
// 그리기 개체와 이미지
// ---------------------------------------------------------------------------

export interface Point {
  x: SHwpUnit
  y: SHwpUnit
}

export interface ShapeOutline {
  line: BorderLine
  /** 화살촉. HWP 열거 값. */
  headStyle?: number
  tailStyle?: number
  headSize?: number
  tailSize?: number
  /** 둥근 이음. */
  outlineStyle?: number
  alpha?: number
}

/** 그리기 개체 안에 그려지는 텍스트. */
export interface ShapeTextBox {
  paragraphs: Paragraph[]
  margins: CellMargins
  verticalAlign: VerticalAlign
  /** 도형과 함께 텍스트를 회전한다. */
  editable?: boolean
  /** 텍스트 각도, 1/100도. */
  textAngle?: number
  /** 텍스트에 맞게 도형을 자동으로 키운다. */
  autoExpand?: boolean
}

interface ShapeBase {
  placement: ObjectPlacement
  outline?: ShapeOutline
  fill?: Fill
  shadow?: { kind: number; color: Rgb; offsetX: SHwpUnit; offsetY: SHwpUnit; alpha?: number }
  /** 회전, 1/100도, 시계방향. */
  rotation?: number
  flipHorizontal?: boolean
  flipVertical?: boolean
  textBox?: ShapeTextBox
}

export interface PictureControl extends ShapeBase {
  type: 'picture'
  /** {@link HwpDocument.binData}의 인덱스. */
  binDataId: number
  /** 자르기용 원본 사각형. */
  crop?: { left: SHwpUnit; top: SHwpUnit; right: SHwpUnit; bottom: SHwpUnit }
  /** 프레임과 이미지 사이의 안쪽 여백. */
  innerMargins?: CellMargins
  brightness?: number
  contrast?: number
  effect?: ImageEffect
  alpha?: number
  /** "원래 크기로" 기능을 위해 보관하는 원본 크기. */
  originalSize?: { width: HwpUnit; height: HwpUnit }
}

export interface LineControl extends ShapeBase {
  type: 'line'
  start: Point
  end: Point
}

export interface RectangleControl extends ShapeBase {
  type: 'rectangle'
  /** 모서리 둥글기. 짧은 변에 대한 비율로 0-100. */
  cornerRadius?: number
}

export interface EllipseControl extends ShapeBase {
  type: 'ellipse'
  /** 호 / 활 모양 / 부채꼴 변종. */
  arcKind?: number
  arcStart?: Point
  arcEnd?: Point
}

export interface ArcControl extends ShapeBase {
  type: 'arc'
  arcKind: number
  center: Point
  axis1: Point
  axis2: Point
}

export interface PolygonControl extends ShapeBase {
  type: 'polygon'
  points: Point[]
}

export interface CurveControl extends ShapeBase {
  type: 'curve'
  points: Point[]
  /** 점마다 세그먼트 종류 바이트 하나: 직선 또는 곡선. */
  segmentTypes?: number[]
}

export interface ConnectLineControl extends ShapeBase {
  type: 'connectLine'
  start: Point
  end: Point
  connectKind: number
}

export interface TextArtControl extends ShapeBase {
  type: 'textArt'
  text: string
  fontName: string
  fontStyle?: string
  shapeKind?: number
  lineSpacing?: number
  charSpacing?: number
  align?: number
}

export interface OleControl extends ShapeBase {
  type: 'ole'
  binDataId: number
  /** 알 수 있을 때의 OLE 개체 클래스 / prog id. */
  progId?: string
  extent?: { width: HwpUnit; height: HwpUnit }
}

export interface ContainerControl extends ShapeBase {
  type: 'container'
  children: DrawingControl[]
}

export type DrawingControl =
  | PictureControl
  | LineControl
  | RectangleControl
  | EllipseControl
  | ArcControl
  | PolygonControl
  | CurveControl
  | ConnectLineControl
  | TextArtControl
  | OleControl
  | ContainerControl

// ---------------------------------------------------------------------------
// 수식
// ---------------------------------------------------------------------------

export interface EquationControl {
  type: 'equation'
  placement: ObjectPlacement
  /** HWP 수식 스크립트. 예: `x = {-b +- sqrt {b^2 -4ac}} over {2a}`. */
  script: string
  /** 기준선 오프셋, 퍼센트. */
  baseLine?: number
  charSize?: HwpUnit
  color?: Rgb
  fontName?: string
  lineMode?: number
  /** 같은 수식의 LaTeX 표현. 있을 때만. */
  latex?: string
}

// ---------------------------------------------------------------------------
// 주석, 머리말, 꼬리말
// ---------------------------------------------------------------------------

export enum HeaderFooterApplyTo {
  Both = 0,
  Even = 1,
  Odd = 2,
}

export interface HeaderFooterControl {
  type: 'header' | 'footer'
  applyTo: HeaderFooterApplyTo
  paragraphs: Paragraph[]
}

export interface NoteControl {
  type: 'footnote' | 'endnote'
  paragraphs: Paragraph[]
  /** 자동 번호 대신 쓰는 명시적 표시. */
  customMark?: string
  /** 번호 매기기 카운터 재정의. */
  numberShape?: NumberFormat
}

// ---------------------------------------------------------------------------
// 쪽 수준 컨트롤
// ---------------------------------------------------------------------------

export enum AutoNumberKind {
  Page = 0,
  Footnote = 1,
  Endnote = 2,
  Picture = 3,
  Table = 4,
  Equation = 5,
  TotalPage = 6,
}

export interface AutoNumberControl {
  type: 'autoNumber'
  numberKind: AutoNumberKind
  numberFormat: NumberFormat
  /** 번호 앞뒤에 놓는 텍스트. 예: `- 3 -`을 만드는 `-` `-`. */
  prefix?: string
  suffix?: string
  /** 각주 표시가 기본으로 받는 위 첨자 서식을 끈다. */
  supscript?: boolean
}

export interface NewNumberControl {
  type: 'newNumber'
  numberKind: AutoNumberKind
  startNumber: number
}

export enum PageNumberPosition {
  None = 0,
  TopLeft = 1,
  TopCenter = 2,
  TopRight = 3,
  BottomLeft = 4,
  BottomCenter = 5,
  BottomRight = 6,
  OutsideTop = 7,
  OutsideBottom = 8,
  InsideTop = 9,
  InsideBottom = 10,
}

export interface PageNumberPositionControl {
  type: 'pageNumberPosition'
  position: PageNumberPosition
  numberFormat: NumberFormat
  prefix?: string
  suffix?: string
  charShapeId?: number
}

export interface PageHidingControl {
  type: 'pageHiding'
  hideHeader?: boolean
  hideFooter?: boolean
  hideMasterPage?: boolean
  hideBorder?: boolean
  hideFill?: boolean
  hidePageNumber?: boolean
}

export interface PageOddEvenAdjustControl {
  type: 'pageOddEvenAdjust'
  /** 0 = 양쪽, 1 = 짝수 쪽만, 2 = 홀수 쪽만. */
  kind: number
}

export interface IndexMarkControl {
  type: 'indexMark'
  keyword1: string
  keyword2?: string
}

export interface BookmarkControl {
  type: 'bookmark'
  name: string
}

// ---------------------------------------------------------------------------
// 필드
// ---------------------------------------------------------------------------

export enum FieldKind {
  Unknown = 0,
  Date = 1,
  DocDate = 2,
  Path = 3,
  Bookmark = 4,
  MailMerge = 5,
  CrossRef = 6,
  Formula = 7,
  ClickHere = 8,
  Summary = 9,
  UserInfo = 10,
  HyperLink = 11,
  RevisionSign = 12,
  RevisionDelete = 13,
  RevisionAttach = 14,
  RevisionClipping = 15,
  RevisionThought = 16,
  RevisionPersonalComment = 17,
  RevisionSplitParagraph = 18,
  RevisionChangeParagraph = 19,
  RevisionHyperLink = 20,
  RevisionLineHyperLink = 21,
  Memo = 22,
  PrivateInfoSecurity = 23,
  TableOfContents = 24,
}

/**
 * 필드는 텍스트 구간에 걸쳐 있다. 바이너리 포맷에서는 `fieldBegin` /
 * `fieldEnd` 제어 문자 쌍이고, HWPX도 같은 방식으로 모델링한다. 이 모델은
 * 왕복이 정확하도록 쌍을 유지하지만, 빌더 API는 둘을 한꺼번에 내보내는
 * 편의 기능을 제공한다.
 */
export interface FieldBeginControl {
  type: 'fieldBegin'
  fieldKind: FieldKind
  /** 이것과 짝인 `fieldEnd`를 잇는 안정적인 id. */
  id: number
  name?: string
  /** 필드 명령 문자열. 예: 하이퍼링크의 URL. */
  command?: string
  instanceId?: number
  editable?: boolean
  dirty?: boolean
}

export interface FieldEndControl {
  type: 'fieldEnd'
  id: number
}

// ---------------------------------------------------------------------------
// 그 밖의 텍스트 컨트롤
// ---------------------------------------------------------------------------

/** 덧말 — 텍스트 구간의 위나 아래에 붙는 루비 같은 주석. */
export interface DutmalControl {
  type: 'dutmal'
  mainText: string
  subText: string
  /** 0 = 위, 1 = 아래. */
  position: number
  fontSizeRatio?: number
  align?: number
}

/** 겹침 문자 — 여러 글자를 한 글리프 상자에 합친 것. */
export interface ComposeControl {
  type: 'compose'
  chars: string
  /** 0 = 원, 1 = 반전 원, … */
  composeKind: number
  charSize?: number
  charShapeIds?: number[]
}

/** 숨은 설명. */
export interface HiddenCommentControl {
  type: 'hiddenComment'
  paragraphs: Paragraph[]
}

export interface MemoControl {
  type: 'memo'
  memoShapeId: number
  paragraphs: Paragraph[]
  author?: string
  created?: string
}

/** 양식 컨트롤 (버튼, 편집 상자, 콤보 상자 등). */
export interface FormObjectControl {
  type: 'formObject'
  formKind: number
  name: string
  properties: Record<string, string | number | boolean>
  placement: ObjectPlacement
}

/** 프레임은 파싱했지만 본문은 못 한 것. 왕복을 위해 보관한다. */
export interface UnknownControl {
  type: 'unknown'
  ctrlId: string
  /** 라이터가 그대로 다시 내보낼 수 있도록 남긴 원시 레코드 페이로드. */
  raw?: Uint8Array
  placement?: ObjectPlacement
}

// ---------------------------------------------------------------------------
// 인라인 항목
// ---------------------------------------------------------------------------

export interface TextItem {
  type: 'text'
  value: string
}

export interface TabItem {
  type: 'tab'
  width?: HwpUnit
  leader?: LineStyle
}

/** 부드러운 줄바꿈(Shift+Enter) — 새 문단을 시작하지 않는다. */
export interface LineBreakItem {
  type: 'lineBreak'
}

/** 문단 안의 명시적 단 나눔. */
export interface ColumnBreakItem {
  type: 'columnBreak'
}

/** 문단 안의 강제 쪽 나눔. */
export interface PageBreakItem {
  type: 'pageBreak'
}

/** 묶음 빈칸, 고정폭 빈칸, 하이픈 컨트롤. */
export interface SpecialCharItem {
  type: 'specialChar'
  char: 'nbsp' | 'fixedWidthSpace' | 'hyphen' | 'titleMark'
}

export type Control =
  | TableControl
  | DrawingControl
  | EquationControl
  | HeaderFooterControl
  | NoteControl
  | AutoNumberControl
  | NewNumberControl
  | PageNumberPositionControl
  | PageHidingControl
  | PageOddEvenAdjustControl
  | IndexMarkControl
  | BookmarkControl
  | FieldBeginControl
  | FieldEndControl
  | DutmalControl
  | ComposeControl
  | HiddenCommentControl
  | MemoControl
  | FormObjectControl
  | UnknownControl

export type InlineItem =
  | TextItem
  | TabItem
  | LineBreakItem
  | ColumnBreakItem
  | PageBreakItem
  | SpecialCharItem
  | Control

/** 글자 모양 하나를 공유하는 최대 길이의 텍스트 구간. */
export interface Run {
  /** {@link HwpDocument.charShapes}의 인덱스. */
  charShapeId: number
  items: InlineItem[]
}

export interface Paragraph {
  /** {@link HwpDocument.paraShapes}의 인덱스. */
  paraShapeId: number
  /** {@link HwpDocument.styles}의 인덱스. */
  styleId: number
  runs: Run[]
  /** 이 문단을 새 쪽에서 시작한다. */
  pageBreak?: boolean
  /** 이 문단을 다음 단에서 시작한다. */
  columnBreak?: boolean
  /** 앞 문단의 목록 번호를 이어간다. */
  merged?: boolean
  /** 개요 번호 매기기를 위한 명시적 목록 수준 재정의. */
  listLevel?: number
  /** 왕복에서 보존되는 안정적인 id. */
  id?: number
}
