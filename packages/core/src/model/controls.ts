/**
 * 컨트롤 — HWP 문서에서 평문이 아닌 모든 것.
 *
 * 바이너리 포맷에서 컨트롤은 문단 텍스트 안의 제어 문자에 더해, 네 글자 id
 * (`tbl `, `gso `, `secd`, …)로 식별되는 `CTRL_HEADER` 레코드다. HWPX에서는
 * 같은 것들이 `<hp:run>` 안의 요소다. 이 모듈은 그것들을 나타나는 run에
 * 고정시켜 균일하게 모델링한다.
 */

import type { Rgb } from "./color.js";
import type {
  Fill,
  ImageEffect,
  LineStyle,
  NumberFormat,
  VerticalAlign,
} from "./docinfo.js";
import type { TextDirection } from "./section.js";
import type { HwpUnit, SHwpUnit } from "./units.js";

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

/**
 * 세로 정렬(개체 공통 속성 bit 5~7).
 *
 * 명세 표 70은 3 inside, 4 outside도 적었지만 한글 2024는 세로 정렬에 이 값을
 * 만들지 않는다(정정 79). 안쪽·바깥쪽은 가로 정렬({@link HorzAlign})의 값이다.
 * 파일에 3, 4가 있으면 숫자 그대로 읽고 다시 쓴다.
 */
export enum VertAlign {
  Top = 0,
  Center = 1,
  Bottom = 2,
}

/**
 * 떠 있는 개체 주위로 텍스트가 어떻게 흐르는지(본문과의 배치).
 *
 * 명세 표 70은 0~5(Square, Tight, Through, TopAndBottom, BehindText,
 * InFrontOfText)라고 적었지만, 한글 2024가 저장한 값은 아래 넷이다
 * (정오표 73).
 */
export enum TextWrap {
  /** 어울림. */
  Square = 0,
  /** 자리 차지. */
  TopAndBottom = 1,
  /** 글 뒤로. */
  BehindText = 2,
  /** 글 앞으로. */
  InFrontOfText = 3,
}

/** 개체의 번호 종류. 캡션 번호를 어느 번호 체계로 매길지 정한다. */
export enum NumberingKind {
  None = 0,
  Figure = 1,
  Table = 2,
  Equation = 3,
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

/**
 * 개체 캡션(표 71~73). 파일에서는 개체 CTRL_HEADER의 첫 자식 LIST_HEADER와 그 뒤 문단이고,
 * 개체 공통 속성 bit 29가 켜진다.
 *
 * 캡션 리스트는 문단 리스트 헤더(표 65)로 시작하는 {@link ParagraphList}다.
 * 대화상자의 "오른쪽 가운데", "오른쪽 아래"에서 가운데·아래가 세로 정렬(bit 5~6)이다(E34).
 * 세로 정렬이 없으면 한글이 만든 아래 캡션처럼 위로 쓴다.
 */
export interface Caption extends ParagraphList {
  side: CaptionSide;
  /** 여백 부분까지 너비 확대 (개체 속성 -> 캡션에서 확인). */
  fullSize?: boolean;
  /** 캡션 폭. 왼쪽·오른쪽 캡션일 때만 쓴다. */
  width: HwpUnit;
  /** 캡션과 개체 사이 간격. */
  gap: HwpUnit;
  /** 텍스트의 최대 길이. 한글은 개체의 폭을 쓴다. 없으면 쓸 때 개체 폭을 쓴다. */
  maxWidth?: HwpUnit;

  /** 캡션 속성(표 72)에서 bit 0~2 밖의 비트. */
  unknownBits?: number;
  /** 캡션 정보(14B) 뒤에 남은 바이트. 한글 2024는 0을 8바이트 쓴다. */
  trailing?: number[];
}

/**
 * 텍스트 안에 떠 있을 수 있는 모든 개체(표, 이미지, 그리기 개체, 수식 등)가
 * 공유하는 속성.
 */
export interface ObjectPlacement {
  /** 개체를 큰 글자 하나처럼 줄 안에 배치한다. */
  treatAsChar?: boolean;
  /** {@link treatAsChar}일 때 개체가 줄 높이를 밀어 올리게 한다. */
  affectLineSpacing?: boolean;

  vertRelTo: RelativeTo;
  vertAlign?: VertAlign;
  horzRelTo: RelativeTo;
  horzAlign?: HorzAlign;
  /**
   * 쪽 영역 안으로 제한(bit 13). 세로 기준이 문단일 때 개체가 쪽 밖으로
   * 나가지 않게 다음 쪽으로 넘긴다. 이름은 HWPX 속성 이름을 따랐다.
   */
  flowWithText?: boolean;
  /** 서로 겹침 허용(bit 14). */
  allowOverlap?: boolean;
  /** 크기 고정(bit 20). */
  fixedSize?: boolean;

  offsetX: SHwpUnit;
  offsetY: SHwpUnit;
  /**
   * 폭. {@link widthCriterion}이 Absolute가 아니면 HWPUNIT가 아니라 기준에 대한
   * 백분율×100이다(32.42% → 3242. 정정 80). {@link height}도 같다.
   */
  width: HwpUnit;
  height: HwpUnit;
  widthCriterion?: WidthCriterion;
  heightCriterion?: HeightCriterion;

  /** 떠 있는 개체들 사이의 쌓임 순서. */
  zOrder?: number;
  textWrap?: TextWrap;
  textFlowSide?: TextFlowSide;

  marginLeft?: HwpUnit;
  marginRight?: HwpUnit;
  marginTop?: HwpUnit;
  marginBottom?: HwpUnit;

  /** 개체가 쪽 경계를 넘어 나뉘도록 허용한다. */
  allowPageSplit?: boolean;
  /** 개체 보호하기(bit 30, 명세에 없음). 보호된 개체는 한글에서 선택되지 않는다. */
  locked?: boolean;
  /** 번호 종류(bit 26~28). 없으면 쓸 때 개체 종류의 기본값을 쓴다. */
  numberingKind?: NumberingKind;
  /** "개체와 조판 부호를 항상 같은 쪽에 놓기"(명세의 쪽나눔 방지, 오프셋 40). */
  keepWithAnchor?: boolean;

  caption?: Caption;
  /** 개체 설명문. */
  description?: string;
  name?: string;
  instanceId?: number;

  /** 속성 중 뜻을 모르는 비트(bit 1, 31). 다시 쓸 때 그대로 넣는다. */
  unknownBits?: number;
  /**
   * 설명문 뒤에 남은 바이트. 한글 2024는 `00 00` 두 바이트를 쓴다.
   * 없으면 명세대로 아무것도 쓰지 않는다.
   * `null`이면 원본에 설명문 길이 필드부터 없었다(옛 44B 형식).
   */
  trailing?: number[] | null;
}

export const DEFAULT_PLACEMENT: ObjectPlacement = {
  treatAsChar: true,
  vertRelTo: RelativeTo.Paragraph,
  horzRelTo: RelativeTo.Column,
  offsetX: 0,
  offsetY: 0,
  width: 0,
  height: 0,
};

// ---------------------------------------------------------------------------
// 표
// ---------------------------------------------------------------------------

/** 표의 쪽 경계에서 나눔(표 76 bit 0~1, 정정 88). 설명의 앞은 한글 대화상자 표기, 괄호는 HWPX `pageBreak` 값이다(KS X 6101 표 194). */
export enum PageBreakInTable {
  /** 나누지 않음(`NONE`). */
  None = 0,
  /** 셀 단위로 나눔(`TABLE`). 표는 나뉘지만 셀은 나뉘지 않는다. */
  Cell = 1,
  /** 나눔(`CELL`). 셀 안의 텍스트도 나뉜다. 한글이 새 표에 쓰는 값이다. */
  Split = 2,
}

export interface CellMargins {
  left: HwpUnit;
  right: HwpUnit;
  top: HwpUnit;
  bottom: HwpUnit;
}

/** 문단 리스트의 줄바꿈(표 65 bit 3~4). HWPX `lineWrap`의 순서와 같다. */
export enum ListLineWrap {
  /** 일반적인 줄바꿈. HWPX `BREAK`. */
  Break = 0,
  /** 자간을 조정하여 한 줄을 유지. HWPX `SQUEEZE`. */
  Squeeze = 1,
  /** 내용에 따라 폭이 늘어남. HWPX `KEEP`. */
  Keep = 2,
}

/**
 * 문단 리스트. 셀, 캡션, 머리말·꼬리말, 각주·미주, 숨은 설명, 바탕쪽, 메모가 이를 확장한다.
 *
 * HWP에서는 문단 리스트 헤더(표 65, LIST_HEADER 앞 8바이트: 문단 수 UINT32, 리스트 속성 UINT32)와
 * 그 뒤의 형제 문단 레코드다(정정 53, 83). 문단 수는 {@link paragraphs}의 길이로 쓴다. 리스트
 * 속성의 bit 0~6이 아래 세 필드이고, HWPX `hp:subList`의 `textDirection`, `lineWrap`,
 * `vertAlign`에 해당한다. 비트 위치는 셀로 확인했다(정정 85, `experiments/list-header-properties`).
 */
export interface ParagraphList {
  /**
   * 글자 방향(bit 0~2). 없으면 가로. 한글이 쓰지 않는 3~7도 다시 저장할 때 그대로 남으므로
   * 읽은 값을 그대로 둔다.
   */
  textDirection?: TextDirection;
  /** 줄바꿈(bit 3~4). 없으면 일반 줄바꿈. 3도 그대로 둔다. */
  lineWrap?: ListLineWrap;
  /**
   * 세로 정렬(bit 5~6, 파일 값 0 위, 1 가운데, 2 아래). 셀에서 없으면 한글의 새 셀 기본값인
   * 가운데로 쓴다. 범위 밖 값 3은 이 필드 없이 {@link listUnknownBits}로 남는다.
   */
  verticalAlign?: VerticalAlign;
  /**
   * 리스트 속성에서 이 객체의 필드로 읽지 않은 비트(bit 7~31, 범위 밖 세로 정렬 3이면 bit 5~6).
   * 셀은 bit 16~20을 셀 필드로 읽으므로 여기에 두지 않는다. 한글은 셀에서 bit 24, 26을 흔히
   * 켜지만 HWPX에 대응 속성이 없고 뜻을 모른다. 다시 쓸 때 그대로 넣는다.
   */
  listUnknownBits?: number;
  paragraphs: Paragraph[];
}

export interface TableCell extends ParagraphList {
  /** 열 주소 (0부터 시작) */
  col: number;
  /** 행 주소 (0부터 시작) */
  row: number;
  /** 열의 병합 개수 */
  colSpan: number;
  /** 행의 병합 개수 */
  rowSpan: number;
  /** 셀의 폭 */
  width: HwpUnit;
  /** 셀의 높이 */
  height: HwpUnit;
  /** 셀 4방향 여백 (왼쪽-오른쪽-위-아래 순서) */
  margins?: CellMargins;
  /** {@link HwpDocument.borderFills}의 인덱스. */
  borderFillId?: number;
  /** 셀 안 여백 지정(bit 16, HWPX `hasMargin`). 한글은 셀 여백을 직접 정하면 켠다. */
  hasMargin?: boolean;
  /** 셀 보호(bit 17, HWPX `protect`). */
  protect?: boolean;
  /** 제목 셀(bit 18, HWPX `header`). 표의 제목 줄 반복에 쓰인다. */
  header?: boolean;
  /** 양식 모드에서 편집 가능(bit 19, HWPX `editable`). */
  editable?: boolean;
  /** bit 20, HWPX `dirty`. 한글 자동화의 셀 파라미터 `Dirty`이며 뜻은 확인하지 않았다. */
  dirty?: boolean;
  /**
   * 셀 LIST_HEADER에서 셀 속성(표 80) 26B 뒤에 남는 바이트. 명세에 없다. 한글 2024는 12B나 13B를
   * 쓰고, 첫 UINT32는 대개 셀 폭과 같고 나머지는 0이었다(뜻 미확인). 읽은 셀은 그대로 다시 붙인다.
   * 없으면(새 셀) 한글처럼 셀 폭 UINT32와 0 9바이트를 쓴다.
   */
  trailing?: Uint8Array;
  /** 셀 본문. 셀은 항상 문단을 최소 하나 담는다. */
  paragraphs: Paragraph[];
  /** 계산되는 셀일 때의 `=SUM(ABOVE)` 형태 수식. */
  formula?: string;
}

export interface TableRow {
  cells: TableCell[];
  /** 명시적 행 높이. 없으면 내용에서 유도한다. */
  height?: HwpUnit;
}

export interface TableControl {
  type: "table";
  placement: ObjectPlacement;
  rows: TableRow[];
  /** 균일한 안쪽 여백. 셀별로 재정의할 수 있다. */
  cellMargins: CellMargins;
  cellSpacing?: HwpUnit;
  borderFillId?: number;
  /** 쪽 경계에서 나눔(표 76 bit 0~1). 없으면 한글의 새 표처럼 {@link PageBreakInTable.Split}(나눔)으로 쓴다. */
  pageBreak?: PageBreakInTable;
  /** 앞의 N개 행을 쪽마다 제목으로 반복한다. */
  repeatHeaderRows?: number;
  /**
   * 표 속성 bit 3(HWPX `noAdjust`). KS X 6101 표 194는 "셀 너비/높이 값의 최소 단위(1 pt) 보정 여부"로
   * 설명한다. 이름대로면 켜졌을 때 보정하지 않는다. 한글이 다시 저장할 때 보존한다. 켜는 한글 조작과 실제
   * 동작은 확인하지 않았다(정정 88).
   */
  noAdjust?: boolean;
  /**
   * 표 속성(표 76)에서 bit 0~3 밖의 비트. 한글은 bit 25, 26을 보존하고(셀에 글자를 넣으면 bit 26이
   * 켜진다) bit 24는 다시 저장할 때 지운다. 뜻은 미확인이다(정정 88).
   */
  unknownBits?: number;
  /**
   * 셀 영역(표 74 Valid Zone Info, 표 78 영역 속성, HWPX `cellzone`). 셀 범위에 테두리/배경을
   * 지정한 기록이다. 개수(Valid Zone Info Size)는 배열 길이로 정한다. 없으면 0개로 쓴다.
   */
  cellZones?: CellZone[];
}

/** 표의 셀 영역(표 78). 주소는 0부터 세고 시작·끝 셀을 포함한다. */
export interface CellZone {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  /** {@link HwpDocument.borderFills}의 인덱스. */
  borderFillId?: number;
}

// ---------------------------------------------------------------------------
// 그리기 개체와 이미지
// ---------------------------------------------------------------------------

export interface Point {
  x: SHwpUnit;
  y: SHwpUnit;
}

/** 선 끝 모양(표 87 bit 6~9). 명세 기본값은 그림 Round, 그리기 개체 Flat이다. */
export enum LineEndCap {
  Round = 0,
  Flat = 1,
}

/** 화살표 모양(표 87 bit 10~15, 16~21). 명세는 끝 모양에만 값을 적었다. */
export enum ArrowStyle {
  None = 0,
  /** 화살 모양. */
  Arrow = 1,
  /** 오목한 화살 모양. */
  Spear = 2,
  /** 속이 빈 다이아몬드 모양. */
  EmptyDiamond = 3,
  /** 속이 빈 원 모양. */
  EmptyCircle = 4,
  /** 속이 빈 사각 모양. */
  EmptyBox = 5,
  /** 속이 채워진 다이아몬드 모양. */
  Diamond = 6,
  /** 속이 채워진 원 모양. */
  Circle = 7,
  /** 속이 채워진 사각 모양. */
  Box = 8,
}

/**
 * 화살표 크기(표 87 bit 22~25, 26~29). 이름은 명세의 "작은-작은" 등을 따랐다. 명세는 7과 8을
 * 모두 "큰-중간"으로 적었는데, 순서로 보아 8은 "큰-큰"이다(한글로 확인하지 않았다).
 */
export enum ArrowSize {
  SmallSmall = 0,
  SmallMedium = 1,
  SmallLarge = 2,
  MediumSmall = 3,
  MediumMedium = 4,
  MediumLarge = 5,
  LargeSmall = 6,
  LargeMedium = 7,
  LargeLarge = 8,
}

/**
 * Outline style(표 88). HWPX `hp:lineShape`의 `outlineStyle`이다. 한글 2024 대화상자에는 "선 굵기
 * 내부 적용" 체크박스뿐이라 0과 2만 만들 수 있다. 1은 한글이 보존하고 HWPX `OUTER`로 내보내지만,
 * 대화상자는 꺼짐으로 보이고 "설정"을 누르면 0으로 바꾼다(정정 90, `experiments/shape-outline-style`).
 */
export enum OutlineStyle {
  Normal = 0,
  /** 대화상자로 만들 수 없다. */
  Outer = 1,
  /** "선 굵기 내부 적용". */
  Inner = 2,
}

/**
 * 그리기 개체의 테두리 선 정보(표 86, 87). SHAPE_COMPONENT에서 Rendering 정보 바로 뒤의 13바이트다.
 * 명세는 선 굵기를 INT16, 전체 11바이트로 적었지만 한글 파일은 굵기가 4바이트, 전체 13바이트다
 * (정정 89).
 */
export interface ShapeLine {
  color: Rgb;
  /** 선 굵기. 한글 기본값 0.12mm는 33이다. */
  width: SHwpUnit;
  /**
   * 선 종류(bit 0~5). 한글 기본 실선이 1이라 테두리선 종류(정정 3)와 같은 번호로 보지만, 실선 밖의
   * 값은 확인하지 않았다.
   */
  style: LineStyle;
  endCap: LineEndCap;
  startArrow: ArrowStyle;
  endArrow: ArrowStyle;
  startArrowSize: ArrowSize;
  endArrowSize: ArrowSize;
  /** 화살표 속을 채운다(bit 30, 31). 한글 기본값은 둘 다 켜짐이다. */
  startArrowFill: boolean;
  endArrowFill: boolean;
  outlineStyle: OutlineStyle;
}

/**
 * 3×3 변환 행렬에서 항상 `0, 0, 1`인 마지막 줄을 뺀 원소 6개(표 85). 파일에 저장된 순서
 * 그대로다.
 */
export type ShapeMatrix = [number, number, number, number, number, number];

/**
 * 개체 요소 속성(표 82~85). 그리기 개체·그림의 SHAPE_COMPONENT 레코드 앞부분이다.
 * 개체의 크기, 반전, 회전, 그리고 그것을 합친 변환 행렬을 담는다.
 */
export interface ShapeComponent {
  /**
   * 개체 컨트롤 ID(표 82). `$rec`(사각형), `$pic`(그림) 등. 문단에 놓인 개체는 이 ID를
   * 두 번 쓴다(명세의 GenShapeObject, 정정 77).
   */
  shapeId: string;
  /** 개체가 속한 묶음 안에서의 X, Y 오프셋. */
  groupOffsetX: SHwpUnit;
  groupOffsetY: SHwpUnit;
  /** 몇 번 묶였는지. */
  groupLevel: number;
  /** 개체 요소의 local file version. 한글 2024는 1을 쓴다. */
  localVersion: number;
  /** 개체를 만들 때의 폭과 높이. */
  initialWidth: HwpUnit;
  initialHeight: HwpUnit;
  /** 개체의 현재 폭과 높이. */
  width: HwpUnit;
  height: HwpUnit;
  /** 속성 bit 0, 1. */
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  /**
   * 속성에서 bit 0, 1을 뺀 비트. 명세에 없지만 한글은 bit 19, 24, 26, 29를 쓴다. 뜻은
   * 모르고, 쓸 때 OR로 합친다.
   */
  unknownBits?: number;
  /** 회전각(HWPUNIT16). 단위는 확인하지 않았다. 저장소 파일은 모두 0이다. */
  rotation: number;
  /** 회전 중심(개체 좌표계). 한글은 폭·높이의 절반을 쓴다. */
  rotationCenter: Point;
  /** Rendering 정보(표 84)의 translation matrix. */
  translation: ShapeMatrix;
  /** scale matrix와 rotation matrix 쌍. 묶을 때마다 하나씩 는다. 개수는 배열 길이로 쓴다. */
  scaleRotations: { scale: ShapeMatrix; rotation: ShapeMatrix }[];
  /**
   * 테두리 선 정보(표 81, 86). 그리기 개체(선, 사각형, 타원, 호, 다각형, 곡선)에만 있고, 그림 등
   * 다른 개체에는 없다.
   */
  line?: ShapeLine;
  /**
   * 채우기 정보(표 81, 28). 그리기 개체에서 테두리 선 바로 뒤에 있다. DocInfo 테두리/배경과 같은
   * 배치다. 한글 대화상자는 색 또는 그러데이션과 그림을 함께 저장한다(정정 92). 다시 썼을 때 원본과
   * 같은 바이트가 되지 않는 채우기(짧은 블록 등)는 두지 않고 `trailing`에 원본 그대로 남긴다.
   */
  fill?: Fill;
  /**
   * 그림자. 명세에 없고, 그리기 개체에서 채우기 바로 뒤 22바이트에 인스턴스 ID와 함께 있다(정정 91,
   * `experiments/shape-shadow`). 그림자가 없어도 종류 0으로 들어 있다. `instanceId`와 함께 읽고 쓴다.
   */
  shadow?: ShapeShadow;
  /**
   * 개체의 인스턴스 ID(UINT32). HWPX `hp:rect` 등의 `instid`와 같은 값이다. 개체마다 다르고 한글이
   * 다시 저장해도 바뀌지 않는다. `shadow`와 함께 있어야 한다.
   */
  instanceId?: number;
  /** 인스턴스 ID 뒤의 1바이트. 뜻을 모른다. 저장소 파일은 모두 0이다. 없으면 0으로 쓴다. */
  afterInstanceId?: number;
  /**
   * 사각형(`$rec`)의 자식 레코드 SHAPE_COMPONENT_RECTANGLE(표 94). SHAPE_COMPONENT의 마지막 자식으로
   * 글상자 뒤에 오고, 쓸 때도 그 자리에 쓴다. 해석할 수 없으면 두지 않고 `childRecords`에 남긴다.
   */
  rectangle?: ShapeRectangle;
  /**
   * 그 뒤의 바이트. 지금까지 본 그리기 개체는 그림자 뒤에서 레코드가 끝났고, 그림은 Rendering 정보
   * 뒤가 비어 있다. 채우기나 그림자를 모델로 읽지 못하면 그 바이트가 여기에 원본 그대로 남는다.
   */
  trailing?: Uint8Array;
}

/**
 * 사각형 개체 속성(표 94). 33바이트: 모서리 곡률 BYTE, 꼭짓점 4개. 명세는 x 4개 다음 y 4개로 적었지만
 * 실제는 (x, y) 쌍 4개다(정정 93, E42, `experiments/shape-rectangle`).
 */
export interface ShapeRectangle {
  /**
   * 모서리 곡률(%). 한글 2024 대화상자의 직각 0, 둥근 모양 20, 반원 50이고 "곡률 지정"은 0~50만
   * 받는다. 짧은 변에 대한 비율이다.
   */
  cornerCurvature: number;
  /**
   * 꼭짓점 4개(개체 좌표계). 한글은 왼쪽 위부터 시계 방향으로 (0, 0), (폭, 0), (폭, 높이), (0, 높이)를
   * 쓴다. 폭·높이는 개체를 만들 때의 크기(`initialWidth`, `initialHeight`)이고, 크기를 바꿔도
   * 그대로다. 바뀐 크기는 SHAPE_COMPONENT의 현재 폭·높이와 scale matrix에 담긴다.
   */
  points: [Point, Point, Point, Point];
  /** 33바이트 뒤의 바이트. 지금까지 본 파일에는 없다. 그대로 붙인다. */
  trailing?: Uint8Array;
}

/**
 * 그림자 종류. HWP 값과 HWPX `hp:shadow`의 `type`이다(정정 91). 한글 2024 대화상자의 아이콘 10개는
 * 1~8, 13, 14이고 9~12를 고르는 곳은 없다.
 */
export enum ShapeShadowKind {
  None = 0,
  /** `PARELLEL_LEFTTOP`(HWPX 철자 그대로). */
  ParallelLeftTop = 1,
  ParallelRightTop = 2,
  ParallelLeftBottom = 3,
  ParallelRightBottom = 4,
  /** `SHEAR_LEFTTOP`. */
  ShearLeftTop = 5,
  ShearRightTop = 6,
  ShearLeftBottom = 7,
  ShearRightBottom = 8,
  /** `SCALE_NARROW`. */
  ScaleNarrow = 13,
  /** `SCALE_ENLARGE`. */
  ScaleEnlarge = 14,
}

/** 그리기 개체의 그림자(정정 91). */
export interface ShapeShadow {
  kind: ShapeShadowKind;
  /** 한글 기본값은 `#B2B2B2`다. 그림자가 없어도 들어 있다. */
  color: Rgb;
  /** 가로·세로 이동. 1mm가 283이다. */
  offsetX: SHwpUnit;
  offsetY: SHwpUnit;
  /**
   * 투명도 0~255. 0은 불투명, 255는 완전히 투명하다. 대화상자의 30%가 77이다. HWPX `hp:shadow`의
   * `alpha`다. {@link ColorFill.transparency}와 같은 방향이다.
   */
  transparency: number;
}

/** 그리기 개체 안에 그려지는 텍스트. */
export interface ShapeTextBox {
  paragraphs: Paragraph[];
  margins: CellMargins;
  verticalAlign: VerticalAlign;
  /** 도형과 함께 텍스트를 회전한다. */
  editable?: boolean;
  /** 텍스트 각도, 1/100도. */
  textAngle?: number;
  /** 텍스트에 맞게 도형을 자동으로 키운다. */
  autoExpand?: boolean;
}

interface ShapeBase {
  placement: ObjectPlacement;
  outline?: ShapeLine;
  fill?: Fill;
  shadow?: ShapeShadow;
  /** 회전, 1/100도, 시계방향. */
  rotation?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  textBox?: ShapeTextBox;
}

export interface PictureControl extends ShapeBase {
  type: "picture";
  /** {@link HwpDocument.binData}의 인덱스. */
  binDataId: number;
  /** 자르기용 원본 사각형. */
  crop?: { left: SHwpUnit; top: SHwpUnit; right: SHwpUnit; bottom: SHwpUnit };
  /** 프레임과 이미지 사이의 안쪽 여백. */
  innerMargins?: CellMargins;
  brightness?: number;
  contrast?: number;
  effect?: ImageEffect;
  transparency?: number;
  /** "원래 크기로" 기능을 위해 보관하는 원본 크기. */
  originalSize?: { width: HwpUnit; height: HwpUnit };
}

export interface LineControl extends ShapeBase {
  type: "line";
  start: Point;
  end: Point;
}

export interface RectangleControl extends ShapeBase {
  type: "rectangle";
  /** 모서리 둥글기. 짧은 변에 대한 비율로 0-100. */
  cornerRadius?: number;
}

export interface EllipseControl extends ShapeBase {
  type: "ellipse";
  /** 호 / 활 모양 / 부채꼴 변종. */
  arcKind?: number;
  arcStart?: Point;
  arcEnd?: Point;
}

export interface ArcControl extends ShapeBase {
  type: "arc";
  arcKind: number;
  center: Point;
  axis1: Point;
  axis2: Point;
}

export interface PolygonControl extends ShapeBase {
  type: "polygon";
  points: Point[];
}

export interface CurveControl extends ShapeBase {
  type: "curve";
  points: Point[];
  /** 점마다 세그먼트 종류 바이트 하나: 직선 또는 곡선. */
  segmentTypes?: number[];
}

export interface ConnectLineControl extends ShapeBase {
  type: "connectLine";
  start: Point;
  end: Point;
  connectKind: number;
}

export interface TextArtControl extends ShapeBase {
  type: "textArt";
  text: string;
  fontName: string;
  fontStyle?: string;
  shapeKind?: number;
  lineSpacing?: number;
  charSpacing?: number;
  align?: number;
}

export interface OleControl extends ShapeBase {
  type: "ole";
  binDataId: number;
  /** 알 수 있을 때의 OLE 개체 클래스 / prog id. */
  progId?: string;
  extent?: { width: HwpUnit; height: HwpUnit };
}

export interface ContainerControl extends ShapeBase {
  type: "container";
  children: DrawingControl[];
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
  | ContainerControl;

// ---------------------------------------------------------------------------
// 수식
// ---------------------------------------------------------------------------

export interface EquationControl {
  type: "equation";
  placement: ObjectPlacement;
  /** HWP 수식 스크립트. 예: `x = {-b +- sqrt {b^2 -4ac}} over {2a}`. */
  script: string;
  /** 기준선 오프셋, 퍼센트. */
  baseLine?: number;
  charSize?: HwpUnit;
  color?: Rgb;
  fontName?: string;
  lineMode?: number;
  /** 같은 수식의 LaTeX 표현. 있을 때만. */
  latex?: string;
}

// ---------------------------------------------------------------------------
// 주석, 머리말, 꼬리말
// ---------------------------------------------------------------------------

export enum HeaderFooterApplyTo {
  Both = 0,
  Even = 1,
  Odd = 2,
}

export interface HeaderFooterControl extends ParagraphList {
  type: "header" | "footer";
  applyTo: HeaderFooterApplyTo;
  /** 속성(표 141)에서 모델이 해석하지 않는 비트(bit 2 이상). 한글은 쓰레기 값을 쓰기도 한다. */
  unknownBits?: number;
  /** CTRL_HEADER에서 속성 뒤의 바이트. 한글은 4바이트를 더 쓴다. */
  trailing?: Uint8Array;
  /**
   * LIST_HEADER에서 문단 리스트 헤더 8바이트 뒤의 바이트. 텍스트 영역 폭·높이 등(표 140)으로
   * 보이지만 해석하지 않고 그대로 붙인다. 없으면 8바이트만 쓴다.
   */
  listTrailing?: Uint8Array;
}

export interface NoteControl extends ParagraphList {
  type: "footnote" | "endnote";
  /** CTRL_HEADER에서 ctrlId 뒤의 바이트. 명세는 8바이트를 쓴다고 적는다(4.3.10.4). */
  trailing?: Uint8Array;
  /** LIST_HEADER에서 문단 리스트 헤더 8바이트 뒤의 바이트. 해석하지 않고 그대로 붙인다. */
  listTrailing?: Uint8Array;
  /** 자동 번호 대신 쓰는 명시적 표시. */
  customMark?: string;
  /** 번호 매기기 카운터 재정의. */
  numberShape?: NumberFormat;
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

/** 자동 번호(표 142). 비트의 뜻은 명세(표 143)를 따랐고 한글로 확인하지 않았다. */
export interface AutoNumberControl {
  type: "autoNumber";
  numberKind: AutoNumberKind;
  numberFormat: NumberFormat;
  /** 번호. 한글은 1을 쓴다. */
  number?: number;
  /** 번호 모양이 사용자 지정 문자일 때의 문자. */
  userChar?: string;
  /** 번호 앞뒤에 놓는 텍스트. 예: `- 3 -`을 만드는 `-` `-`. */
  prefix?: string;
  suffix?: string;
  /** 각주 표시가 기본으로 받는 위 첨자 서식을 끈다. */
  supscript?: boolean;
  /** 속성에서 모델이 해석하지 않는 비트(bit 13 이상). 쓸 때 OR로 합친다. */
  unknownBits?: number;
}

export interface NewNumberControl {
  type: "newNumber";
  numberKind: AutoNumberKind;
  startNumber: number;
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
  type: "pageNumberPosition";
  position: PageNumberPosition;
  numberFormat: NumberFormat;
  prefix?: string;
  suffix?: string;
  charShapeId?: number;
}

/** 현재 쪽만 감추기(표 145). 비트 0~5를 한글로 확인했다(정오표 E24). */
export interface PageHidingControl {
  type: "pageHiding";
  hideHeader?: boolean;
  hideFooter?: boolean;
  hideMasterPage?: boolean;
  hideBorder?: boolean;
  hideFill?: boolean;
  hidePageNumber?: boolean;
  /** 속성에서 모델이 해석하지 않는 비트(bit 6 이상). 쓸 때 OR로 합친다. */
  unknownBits?: number;
}

export interface PageOddEvenAdjustControl {
  type: "pageOddEvenAdjust";
  /** 0 = 양쪽, 1 = 짝수 쪽만, 2 = 홀수 쪽만. */
  kind: number;
}

export interface IndexMarkControl {
  type: "indexMark";
  keyword1: string;
  keyword2?: string;
}

export interface BookmarkControl {
  type: "bookmark";
  name: string;
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
  type: "fieldBegin";
  fieldKind: FieldKind;
  /** 이것과 짝인 `fieldEnd`를 잇는 안정적인 id. */
  id: number;
  name?: string;
  /** 필드 명령 문자열. 예: 하이퍼링크의 URL. */
  command?: string;
  instanceId?: number;
  /** 읽기 전용 상태에서도 수정할 수 있다(표 155 bit 0). */
  editable?: boolean;
  /** 필드 내용이 수정됐다(표 155 bit 15). */
  dirty?: boolean;
  /**
   * CTRL_HEADER의 ctrlId. 없으면 `fieldKind`로 정한다. 한글은 메모 필드의 CTRL_HEADER에
   * `%unk`를 쓰고 문단 텍스트에는 `%%me`를 쓴다(정오표 71).
   */
  ctrlId?: string;
  /** 속성(표 155)에서 모델이 해석하지 않는 비트. 쓸 때 OR로 합친다. */
  unknownBits?: number;
  /** 기타 속성 1바이트. */
  extraProperties?: number;
  /** 고유 아이디 뒤의 바이트. 메모 필드는 MEMO_LIST의 메모 번호(UINT32)를 둔다(정오표 71). */
  trailing?: Uint8Array;
  /** CTRL_HEADER 아래의 CTRL_DATA 페이로드. 쓸 때 그대로 둔다. */
  ctrlData?: Uint8Array;
  /** 문단 텍스트에서 필드 시작 문자 뒤의 코드 단위 6개. 없으면 ctrlId와 0으로 채운다. */
  textData?: number[];
}

export interface FieldEndControl {
  type: "fieldEnd";
  id: number;
  /** 문단 텍스트에서 필드 끝 문자 뒤의 코드 단위 6개. 없으면 0으로 채운다. 뜻은 모른다. */
  textData?: number[];
}

// ---------------------------------------------------------------------------
// 그 밖의 텍스트 컨트롤
// ---------------------------------------------------------------------------

/** 덧말 — 텍스트 구간의 위나 아래에 붙는 루비 같은 주석. */
export interface DutmalControl {
  type: "dutmal";
  mainText: string;
  subText: string;
  /** 0 = 위, 1 = 아래. */
  position: number;
  fontSizeRatio?: number;
  align?: number;
}

/** 겹침 문자 — 여러 글자를 한 글리프 상자에 합친 것. */
export interface ComposeControl {
  type: "compose";
  chars: string;
  /** 0 = 원, 1 = 반전 원, … */
  composeKind: number;
  charSize?: number;
  charShapeIds?: number[];
}

/** 숨은 설명. */
export interface HiddenCommentControl extends ParagraphList {
  type: "hiddenComment";
  /** CTRL_HEADER에서 ctrlId 뒤의 바이트. */
  trailing?: Uint8Array;
  /** LIST_HEADER에서 문단 리스트 헤더 8바이트 뒤의 바이트. 해석하지 않고 그대로 붙인다. */
  listTrailing?: Uint8Array;
}

export interface MemoControl {
  type: "memo";
  memoShapeId: number;
  paragraphs: Paragraph[];
  author?: string;
  created?: string;
}

/** 양식 컨트롤 (버튼, 편집 상자, 콤보 상자 등). */
export interface FormObjectControl {
  type: "formObject";
  formKind: number;
  name: string;
  properties: Record<string, string | number | boolean>;
  placement: ObjectPlacement;
}

/** 모델이 해석하지 않는 컨트롤 하위 레코드. */
export interface RawChildRecord {
  tagId: number;
  /** 컨트롤 CTRL_HEADER 기준 깊이. 직계 자식이 0이다. */
  depth: number;
  payload: Uint8Array;
}

/** 프레임은 파싱했지만 본문은 못 한 것. 왕복을 위해 보관한다. */
export interface UnknownControl {
  type: "unknown";
  ctrlId: string;
  /**
   * 라이터가 그대로 다시 내보낼 수 있도록 남긴 원시 레코드 페이로드. `placement`를 읽은
   * 그리기 개체(`gso `)는 CTRL_HEADER를 `placement`로 쓰므로 이 값을 두지 않는다.
   */
  raw?: Uint8Array;
  /**
   * CTRL_HEADER 아래의 레코드(그리기 개체의 SHAPE_COMPONENT, 글상자 문단, 수식 등)를 문서
   * 순서대로 보존한 것. `depth`는 CTRL_HEADER의 직계 자식이 0이다. `placement.caption`으로
   * 읽은 캡션 레코드와 `shapeComponent`로 읽은 SHAPE_COMPONENT 레코드는 여기에 넣지 않는다.
   * SHAPE_COMPONENT의 자식(글상자, 도형별 레코드)은 여기에 남는다.
   */
  childRecords?: RawChildRecord[];
  /** 텍스트에서 이 컨트롤을 가리키는 제어 문자. 없으면 11(그리기 개체)로 쓴다. */
  charCode?: number;
  placement?: ObjectPlacement;
  /**
   * 그리기 개체(`gso `)의 SHAPE_COMPONENT. 있으면 캡션 다음, `childRecords` 앞에 CTRL_HEADER의
   * 직계 자식으로 쓴다. 레코드가 짧거나 ID가 두 번 오지 않는 등 해석할 수 없으면 두지 않고
   * 레코드를 `childRecords`에 그대로 남긴다.
   */
  shapeComponent?: ShapeComponent;
}

// ---------------------------------------------------------------------------
// 인라인 항목
// ---------------------------------------------------------------------------

export interface TextItem {
  type: "text";
  value: string;
}

export interface TabItem {
  type: "tab";
  width?: HwpUnit;
  leader?: LineStyle;
  /**
   * 문단 텍스트에서 탭 문자 뒤의 코드 단위 6개. 앞 2개는 폭이고 쓸 때 {@link width}로 덮는다.
   * 한글은 셋째 코드 단위에 `0x0100`을 쓰지만 뜻은 모른다. 없으면 폭 뒤를 0으로 채운다.
   */
  textData?: number[];
}

/** 부드러운 줄바꿈(Shift+Enter) — 새 문단을 시작하지 않는다. */
export interface LineBreakItem {
  type: "lineBreak";
}

/** 문단 안의 명시적 단 나눔. */
export interface ColumnBreakItem {
  type: "columnBreak";
}

/** 문단 안의 강제 쪽 나눔. */
export interface PageBreakItem {
  type: "pageBreak";
}

/** 묶음 빈칸, 고정폭 빈칸, 하이픈 컨트롤. */
export interface SpecialCharItem {
  type: "specialChar";
  char: "nbsp" | "fixedWidthSpace" | "hyphen" | "titleMark";
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
  | UnknownControl;

export type InlineItem =
  | TextItem
  | TabItem
  | LineBreakItem
  | ColumnBreakItem
  | PageBreakItem
  | SpecialCharItem
  | Control;

/** 글자 모양 하나를 공유하는 최대 길이의 텍스트 구간. */
export interface Run {
  /** {@link HwpDocument.charShapes}의 인덱스. */
  charShapeId: number;
  items: InlineItem[];
}

export interface Paragraph {
  /** {@link HwpDocument.paraShapes}의 인덱스. */
  paraShapeId: number;
  /** {@link HwpDocument.styles}의 인덱스. */
  styleId: number;
  runs: Run[];
  /** 이 문단을 새 쪽에서 시작한다. */
  pageBreak?: boolean;
  /** 이 문단을 다음 단에서 시작한다. */
  columnBreak?: boolean;
  /**
   * 문단 머리 단 나누기 종류에서 모델이 해석하지 않는 비트. 쓸 때 OR로 합친다.
   * 0x01(구역 나누기)은 구역 첫 문단에, 0x02(다단 나누기)는 `cold`를 가진 문단에 붙는다.
   */
  divideSortUnknownBits?: number;
  /** 앞 문단의 목록 번호를 이어간다. */
  merged?: boolean;
  /** 개요 번호 매기기를 위한 명시적 목록 수준 재정의. */
  listLevel?: number;
  /** 왕복에서 보존되는 안정적인 id. */
  id?: number;
  /** 변경 추적 병합 문단 여부(UINT16, 5.0.3.2+). 뜻을 다 알지 못해 값 그대로 둔다. 0이면 생략. */
  trackChangeMerged?: number;
  /**
   * 한글이 마지막으로 조판한 줄 배치 캐시. 읽은 그대로 다시 쓴다.
   * 없으면(새로 만든 문단) 코덱이 필요한 경우에만 만들어 쓴다. 텍스트를 고쳐도 갱신하지 않는다.
   */
  lineSegments?: LineSegment[];
  /** 텍스트 구간 표시(형광펜, 교정 부호 등). 구간끼리 겹칠 수 있다. */
  rangeTags?: RangeTag[];
  /**
   * 문단 끝 글자(0x0D)의 글자 모양. 마지막 run과 다를 때만 둔다. 한글은 문단 끝에 글자 모양을
   * 따로 붙이기도 한다. 빈 문단은 이 필드 대신 유일한 run의 `charShapeId`가 문단 끝 글자 모양이다.
   */
  paraEndCharShapeId?: number;
  /**
   * 구역 첫 문단에서 구역 정의·단 정의 컨트롤 자리의 글자 모양. 첫 run과 다를 때만 둔다.
   * 쓸 때 이 자리는 코덱이 만들므로 run이 아닌 이 필드로 보존한다.
   */
  sectionControlCharShapeId?: number;
}

/** 줄 배치 캐시 한 칸(줄 하나, 또는 줄 안의 세그먼트 하나). 길이는 HWPUNIT. */
export interface LineSegment {
  /** 이 줄이 시작하는 글자 위치. */
  textStart: number;
  /** 줄의 세로 위치. */
  y: number;
  height: number;
  textHeight: number;
  /** 줄의 세로 위치에서 베이스라인까지 거리. */
  baselineGap: number;
  lineSpacing: number;
  /** 단 안에서의 시작 위치. */
  x: number;
  width: number;
  /** 쪽/단 첫 줄, 빈 세그먼트 등 조판 표시 비트. */
  flags: LineSegmentFlag;
}

export interface LineSegmentFlag {
  /** 페이지의 첫 줄인지 여부 */
  firstLineInPage?: boolean;
  /** 컬럼의 첫 줄인지 여부 */
  firstLineInColumn?: boolean;
  /** 텍스트가 배열되지 않은 빈 세그먼트인지 여부 */
  emptySegment?: boolean;
  /** 줄의 첫 세그먼트인지 여부 */
  firstSegmentInLine?: boolean;
  /** 줄의 마지막 세그먼트인지 */
  lastSegmentInLine?: boolean;
  /** 줄의 마지막에 auto-hyphenation이 수행되었는지 여부 */
  autoHyphenation?: boolean;
  /** indentation 여부 */
  indentation?: boolean;
  /** 문단 머리 모양 적용 */
  headingApplied?: boolean;
  /** 구현상의 편의를 위한 property */
  unknownBits?: number;
}

/**
 * 영역 태그의 종류(태그 상위 8비트). 한글로 확인한 값만 둔다(정오표 72, E29).
 * 파일의 다른 값도 그대로 읽고 쓴다.
 */
export enum RangeTagKind {
  /** 형광펜. 데이터는 형광펜 색 COLORREF(`0x00BBGGRR`)의 아래 3바이트다. */
  Highlight = 2,
}

/**
 * 문단의 영역 태그(표 63). 한글은 형광펜을 종류 2로 저장한다(정오표 72, E29). 명세가 함께 적은
 * 교정 부호는 한글 2024에서 20가지 모두 필드로 저장됐고, 변경 내용 추적의 글자 넣기도 영역 태그를 쓰지 않았다.
 */
export interface RangeTag {
  /** 구간 시작 글자 위치. PARA_TEXT 코드 단위이고 컨트롤 문자의 8칸도 센다. */
  start: number;
  /** 구간 끝 글자 위치. 이 위치의 글자는 구간에 들지 않는다. */
  end: number;
  /** 종류(0~255). {@link RangeTagKind} 밖의 값은 뜻을 모른다. */
  kind: RangeTagKind;
  /** 종류별 데이터(24비트). 형광펜은 색 COLORREF(`0x00BBGGRR`)의 아래 3바이트다. */
  data: number;
}
