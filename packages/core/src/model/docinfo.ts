/**
 * 문서 전역 공유 자원 — HWP 문서의 "DocInfo" 쪽 절반.
 *
 * HWP는 서식을 텍스트에 직접 붙이지 않는다. 텍스트는 *글자 모양 id*를
 * 가리키고 문단은 *문단 모양 id*를 가리키며, 그 모양들은 평평한 문서 전역
 * 표에 산다. 이 모듈이 그 표를 모델링한다. HWPX에서는 같은 구조가
 * `Contents/header.xml` 안의 `<hh:charPr>`, `<hh:paraPr>` 등으로 나타난다.
 */

import type { Rgb } from "./color.js";
import type { HwpUnit, SHwpUnit } from "./units.js";

/**
 * HWP는 글꼴을 문자 체계별로 해석한다. 글자 모양의 모든 언어별 배열이 이
 * 열거형으로, 이 순서대로 인덱싱된다.
 */
export enum Lang {
  Hangul = 0,
  Latin = 1,
  Hanja = 2,
  Japanese = 3,
  Other = 4,
  Symbol = 5,
  User = 6,
}

export const LANG_COUNT = 7;
export const LANG_NAMES = [
  "hangul",
  "latin",
  "hanja",
  "japanese",
  "other",
  "symbol",
  "user",
] as const;
export type LangName = (typeof LANG_NAMES)[number];
``;
/** {@link Lang}마다 항목 하나씩, 7개짜리 튜플. */
export type PerLang<T> = [T, T, T, T, T, T, T];

export const perLang = <T>(value: T): PerLang<T> => [
  value,
  value,
  value,
  value,
  value,
  value,
  value,
];

// ---------------------------------------------------------------------------
// 글꼴
// ---------------------------------------------------------------------------

export enum FontFamilyKind {
  Unknown = 0,
  Ttf = 1,
  Hft = 2,
}

/** HWPTAG_FACE_NAME이 담는 Panose-1 방식 분류. */
export interface TypeInfo {
  fontFamily: number;
  serifStyle: number;
  weight: number;
  proportion: number;
  contrast: number;
  strokeVariation: number;
  armStyle: number;
  letterform: number;
  midline: number;
  xHeight: number;
}

export interface FontFace {
  /** 저장된 그대로의 글꼴 이름. 예: `함초롬바탕`, `맑은 고딕`. */
  name: string;
  /** 글꼴 종류 힌트. 현대 문서 대부분은 `Ttf`다. */
  kind?: FontFamilyKind;
  /** {@link name}을 쓸 수 없을 때 쓰는 글꼴. */
  substituteFont?: { name: string; kind: FontFamilyKind };
  /** 한글이 시각적 대체 글꼴을 고를 때 쓰는 Panose 계열 메트릭. */
  typeInfo?: TypeInfo;
  /** "기본 글꼴" 메커니즘을 위한 기본 글꼴 이름. */
  baseFont?: string;
}

// ---------------------------------------------------------------------------
// 테두리 / 채우기
// ---------------------------------------------------------------------------

/**
 * 선 종류의 저장값. 실선 이후 값은 HWP 명세 표 25보다 1 크다.
 * 명세에서 '선 없음 = 0'이 누락된 데 따른 차이로 추정한다.
 * 실제 macOS 한글에서 0~13을 확인했다. 14~17의 3D 계열은 같은 차이를 적용한
 * 값이며, 해당 환경에서는 표시되지 않아 시각적으로 검증하지 못했다.
 */
export enum LineStyle {
  None = 0,
  Solid = 1,
  Dashed = 2,
  Dotted = 3,
  DashDot = 4,
  DashDotDot = 5,
  LongDash = 6,
  Circle = 7,
  DoubleSlim = 8,
  SlimThick = 9,
  ThickSlim = 10,
  SlimThickSlim = 11,
  /** 물결. */
  Wave = 12,
  /** 물결 2중선. */
  DoubleWave = 13,
  /** 두꺼운 3D. */
  Thick3D = 14,
  /** 두꺼운 3D (광원 반대). */
  ThickReverse3D = 15,
  /** 3D 단선. */
  ThreeD = 16,
  /** 3D 단선 (광원 반대). */
  Reverse3D = 17,
}

/** HWP가 지원하는 테두리 굵기. 밀리미터 단위이고 열거형 인덱스로 표현한다. */
export enum LineWidth {
  W0_1mm = 0,
  W0_12mm = 1,
  W0_15mm = 2,
  W0_2mm = 3,
  W0_25mm = 4,
  W0_3mm = 5,
  W0_4mm = 6,
  W0_5mm = 7,
  W0_6mm = 8,
  W0_7mm = 9,
  W1_0mm = 10,
  W1_5mm = 11,
  W2_0mm = 12,
  W3_0mm = 13,
  W4_0mm = 14,
  W5_0mm = 15,
}

export interface BorderLine {
  style: LineStyle;
  width: LineWidth;
  color: Rgb;
}

export const NO_BORDER: BorderLine = {
  style: LineStyle.None,
  width: LineWidth.W0_1mm,
  color: 0x000000,
};

export enum FillKind {
  None = 0,
  Color = 1,
  Gradient = 2,
  Image = 3,
}

/**
 * 명세 표 29는 1부터 매기지만 실제 값은 0부터다. 한글 파일의 값을 0~6으로 바꿔
 * 렌더링해 확인했다(6은 무늬 없음). 없음은 -1로 저장된다.
 */
export enum HatchStyle {
  None = -1,
  Horizontal = 0,
  Vertical = 1,
  BackSlash = 2,
  Slash = 3,
  Cross = 4,
  CrossDiagonal = 5,
}

export interface ColorFill {
  kind: FillKind.Color;
  background: Rgb;
  /** 배경 위에 그려지는 해치 무늬. 있을 때만. */
  pattern?: { style: HatchStyle; color: Rgb };
  /** 0-100. 최신 한글이 적용하는 알파. */
  alpha?: number;
}

export enum GradientKind {
  Linear = 1,
  Radial = 2,
  Conical = 3,
  Square = 4,
}

export interface GradientFill {
  kind: FillKind.Gradient;
  type: GradientKind;
  /** 도 단위, 0-360. */
  angle: number;
  /** 중심. 각 축에서 0-100. */
  centerX: number;
  centerY: number;
  /** 번짐/단계 수, 0-100. */
  step: number;
  colors: Rgb[];
  /** 각 색 정지점의 위치, 0-100. 균등 분포면 생략한다. */
  stops?: number[];
  alpha?: number;
}

export enum ImageFillMode {
  Tile = 0,
  TileHorizontalTop = 1,
  TileHorizontalBottom = 2,
  TileVerticalLeft = 3,
  TileVerticalRight = 4,
  Total = 5,
  Center = 6,
  CenterTop = 7,
  CenterBottom = 8,
  LeftCenter = 9,
  LeftTop = 10,
  LeftBottom = 11,
  RightCenter = 12,
  RightTop = 13,
  RightBottom = 14,
  None = 15,
}

export enum ImageEffect {
  RealPicture = 0,
  GrayScale = 1,
  BlackWhite = 2,
  Pattern8x8 = 3,
}

export interface ImageFill {
  kind: FillKind.Image;
  mode: ImageFillMode;
  effect?: ImageEffect;
  /** {@link HwpDocument.binData}의 인덱스. */
  binDataId: number;
  brightness?: number;
  contrast?: number;
  alpha?: number;
}

export interface NoFill {
  kind: FillKind.None;
}

export type Fill = NoFill | ColorFill | GradientFill | ImageFill;

export const NO_FILL: NoFill = { kind: FillKind.None };

/**
 * 테두리와 채우기의 쌍. 셀, 문단, 쪽, 도형이 전부 인덱스로 이것을 참조한다.
 */
export interface BorderFill {
  left: BorderLine;
  right: BorderLine;
  top: BorderLine;
  bottom: BorderLine;
  /**
   * 대각선의 선 종류·굵기·색. 명세 표 27은 종류를 Slash/BackSlash/CrookedSlash로
   * 적지만, 실제 값은 네 방향과 같은 LineStyle이다(빈 문서 1=실선, 점선으로 바꾸면 3).
   * 방향과 꺾임은 slashShape/backSlashShape 등 속성 비트가 정한다.
   */
  diagonal?: BorderLine;
  fill: Fill;
  /** 3D 테두리 효과. */
  threeD?: boolean;
  shadow?: boolean;
  /**
   * Slash 대각선 모양 (HWP 표 24, bit 2~4).
   * 시계 방향으로 각각의 대각선 유무를 나타낸다.
   * - 0b000 (0): 없음.
   * - 0b010 (2): slash.
   * - 0b011 (3): 왼쪽 위 → 아래쪽 변.
   * - 0b110 (6): 왼쪽 위 → 오른쪽 변.
   * - 0b111 (7): 왼쪽 위 → 아래쪽 변 및 오른쪽 변.
   */
  slashShape?: number;
  /**
   * BackSlash 대각선 모양 (HWP 표 24, bit 5~7).
   * 반시계 방향으로 각각의 대각선 유무를 나타낸다.
   * - 0b000 (0): 없음.
   * - 0b010 (2): back slash.
   * - 0b011 (3): 오른쪽 위 → 아래쪽 변.
   * - 0b110 (6): 오른쪽 위 → 왼쪽 변.
   * - 0b111 (7): 오른쪽 위 → 아래쪽 변 및 왼쪽 변.
   */
  backSlashShape?: number;
  /** Slash 꺾은선 유무 (bit 8). macOS 한글의 통제 실험에서 확인했다. */
  slashCrooked?: boolean;
  /** BackSlash 꺾은선 유무 (bit 9). macOS 한글의 통제 실험에서 확인했다. */
  backSlashCrooked?: boolean;
  /**
   * 명세 표 24에서 BackSlash 꺾은선으로 정의한 bit 10.
   * 실제 역할은 미확인이다. 실측한 bit 9와 합치지 않고 별도로 읽고 쓴다.
   */
  backSlashCrookedSpec?: boolean;
  /** Slash 모양 180도 회전 여부 (bit 11). */
  slashRotated?: boolean;
  /** BackSlash 모양 180도 회전 여부 (bit 12). */
  backSlashRotated?: boolean;
  /** 중심선 유무 (HWP bit 13). */
  centerLine?: boolean;
  /** 자동으로 나뉜 표의 경계선 설정. HWPX 속성이며 HWP bit 4와 무관하다. */
  breakCellSeparateLine?: boolean;
}

// ---------------------------------------------------------------------------
// 글자 모양
// ---------------------------------------------------------------------------

export enum UnderlineKind {
  None = 0,
  Bottom = 1,
  Center = 2,
  Top = 3,
}

export enum StrikeoutKind {
  None = 0,
  Continuous = 1,
}

export enum OutlineKind {
  None = 0,
  Solid = 1,
  Dotted = 2,
  Thick = 3,
  Dashed = 4,
  DashDot = 5,
  DashDotDot = 6,
}

export enum ShadowKind {
  None = 0,
  Drop = 1,
  Continuous = 2,
}

export enum EmphasisMark {
  None = 0,
  Dot = 1,
  Ring = 2,
  Tilde = 3,
  Caron = 4,
  Side = 5,
  Colon = 6,
  DoubleDot = 7,
  Hollow = 8,
  BlackHeart = 9,
  Circle = 10,
}

/**
 * 글자 서식. 텍스트 run이 {@link HwpDocument.charShapes}의 인덱스로 이것을
 * 참조한다.
 */
export interface CharShape {
  /** 언어별 글꼴 인덱스. {@link HwpDocument.fonts}를 가리킨다. */
  fontIds: PerLang<number>;
  /** 장평, 퍼센트 (50-200). */
  ratios: PerLang<number>;
  /** 자간, 퍼센트 (-50..50). */
  spacings: PerLang<number>;
  /** 상대 크기, 퍼센트 (10-250). */
  relSizes: PerLang<number>;
  /** 기준선 오프셋, 퍼센트 (-100..100). */
  offsets: PerLang<number>;

  /** HWPUNIT 기준 크기. 11pt 글꼴이면 `pt(11)`을 쓴다. */
  height: HwpUnit;

  bold?: boolean;
  italic?: boolean;
  underline?: { kind: UnderlineKind; style: LineStyle; color: Rgb };
  strikeout?: { kind: StrikeoutKind; style: LineStyle; color: Rgb };
  outline?: OutlineKind;
  shadow?: { kind: ShadowKind; color: Rgb; offsetX: number; offsetY: number };
  emboss?: boolean;
  engrave?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  emphasis?: EmphasisMark;
  /** 한글과 라틴 문자 사이의 공백 압축을 적용한다. */
  useFontSpace?: boolean;
  useKerning?: boolean;

  textColor: Rgb;
  shadeColor: Rgb;
  /** 테두리를 두른 글자를 위한 {@link HwpDocument.borderFills} 인덱스. */
  borderFillId?: number;
}

// ---------------------------------------------------------------------------
// 문단 모양
// ---------------------------------------------------------------------------

export enum Align {
  Justify = 0,
  Left = 1,
  Right = 2,
  Center = 3,
  Distribute = 4,
  Division = 5,
}

export enum VerticalAlign {
  Baseline = 0,
  Top = 1,
  Center = 2,
  Bottom = 3,
}

export enum LineSpacingKind {
  /** 줄의 자연 높이에 대한 퍼센트 (HWP 기본값. 보통 160). */
  Percent = 0,
  /** HWPUNIT 고정 높이. */
  Fixed = 1,
  /** 자연 높이에 고정값을 더한 것. */
  BetweenLines = 2,
  /** 퍼센트. 줄 상자가 아니라 글꼴의 em 상자를 기준으로 잰다. */
  AtLeast = 3,
}

export enum LineBreakLatin {
  Word = 0,
  Hyphen = 1,
  Char = 2,
}

export enum LineBreakHangul {
  Word = 0,
  Char = 1,
}

export enum HeadingKind {
  None = 0,
  Outline = 1,
  Number = 2,
  Bullet = 3,
}

export interface ParagraphBorder {
  /** {@link HwpDocument.borderFills}의 인덱스. */
  borderFillId: number;
  offsetLeft: HwpUnit;
  offsetRight: HwpUnit;
  offsetTop: HwpUnit;
  offsetBottom: HwpUnit;
  /** 연속된 문단들의 테두리를 하나의 상자로 그린다. */
  connect?: boolean;
  /** 그릴 때 문단 여백을 무시한다. */
  ignoreMargin?: boolean;
}

export interface ParaShape {
  align: Align;
  /** 왼쪽 들여쓰기, HWPUNIT. */
  marginLeft: SHwpUnit;
  marginRight: SHwpUnit;
  /** 첫 줄 들여쓰기. 음수면 내어쓰기가 된다. */
  indent: SHwpUnit;
  marginTop: SHwpUnit;
  marginBottom: SHwpUnit;

  lineSpacing: { kind: LineSpacingKind; value: number };

  lineBreakLatin?: LineBreakLatin;
  lineBreakHangul?: LineBreakHangul;

  /** {@link HwpDocument.tabDefs}의 인덱스. */
  tabDefId?: number;
  /** {@link headingKind}에 따라 번호 매기기 또는 글머리표의 인덱스. */
  headingKind?: HeadingKind;
  headingId?: number;
  headingLevel?: number;

  border?: ParagraphBorder;

  /** 이 문단을 다음 문단과 같은 쪽에 유지한다. */
  keepWithNext?: boolean;
  /** 이 문단을 쪽 경계로 절대 나누지 않는다. */
  keepLines?: boolean;
  /** 이 문단 앞에서 쪽 나눔을 강제한다. */
  pageBreakBefore?: boolean;
  /** 쪽 경계에 홀로 남는 첫 줄/끝 줄을 막는다. */
  widowOrphan?: boolean;
  /** 텍스트를 문서 격자에 맞춘다. */
  snapToGrid?: boolean;
  /** 조금 긴 마지막 줄을 앞 줄로 밀어 넣는다. */
  condense?: number;
  verticalAlign?: VerticalAlign;
  /** 계산된 줄 높이 대신 글꼴 자체의 줄 높이를 쓴다. */
  fontLineHeight?: boolean;
  /** 한글과 라틴 문자 / 숫자 사이의 자동 자간 조절을 끈다. */
  autoSpaceLatin?: boolean;
  autoSpaceNumber?: boolean;
}

// ---------------------------------------------------------------------------
// 탭
// ---------------------------------------------------------------------------

export enum TabKind {
  Left = 0,
  Right = 1,
  Center = 2,
  Decimal = 3,
}

export interface TabStop {
  position: HwpUnit;
  kind: TabKind;
  fillStyle: LineStyle;
}

export interface TabDef {
  /** 문단의 왼쪽 들여쓰기 위치에 자동 탭 정지. */
  autoTabLeft?: boolean;
  /** 문단의 오른쪽 들여쓰기 위치에 자동 탭 정지. */
  autoTabRight?: boolean;
  stops: TabStop[];
}

// ---------------------------------------------------------------------------
// 번호 매기기 / 글머리표
// ---------------------------------------------------------------------------

export enum NumberFormat {
  Digit = 0,
  CircledDigit = 1,
  RomanUpper = 2,
  RomanLower = 3,
  LatinUpper = 4,
  LatinLower = 5,
  CircledLatinUpper = 6,
  CircledLatinLower = 7,
  HangulSyllable = 8,
  CircledHangulSyllable = 9,
  HangulJamo = 10,
  CircledHangulJamo = 11,
  HangulPhonetic = 12,
  Ideograph = 13,
  CircledIdeograph = 14,
  DecagonCircle = 15,
  DecagonCircleHanja = 16,
  Symbol = 0x80,
  UserChar = 0x81,
}

/** 번호 정의의 개요 수준 하나. */
export interface NumberingLevel {
  /** 예: `^1.` — `^1`..`^7`이 해당 수준의 카운터를 끼워 넣는다. */
  format: string;
  numberFormat: NumberFormat;
  align: Align;
  /** 번호에서 텍스트까지의 거리. 비율(퍼센트) 또는 폭. */
  widthAdjust: number;
  /** 번호 뒤에서 텍스트가 들여쓰기되는 거리. */
  distance: number;
  /** {@link distance}를 번호 폭에 대한 퍼센트로 취급한다. */
  distanceIsRatio?: boolean;
  /** 상위 수준의 번호를 포함한다. 예: `1.2.3`. */
  includeUpperLevels?: boolean;
  /** 이 수준에서 번호를 다시 시작한다. */
  startNumber?: number;
  charShapeId?: number;
}

export interface Numbering {
  levels: NumberingLevel[];
  startNumber?: number;
}

export interface Bullet {
  /** 글머리표 문자 자체. 예: `•`. */
  char: string;
  /** {@link char} 대신 이미지를 쓴다. */
  image?: {
    binDataId: number;
    brightness?: number;
    contrast?: number;
    effect?: ImageEffect;
  };
  checkedChar?: string;
  level: NumberingLevel;
}

// ---------------------------------------------------------------------------
// 스타일
// ---------------------------------------------------------------------------

export enum StyleKind {
  Paragraph = 0,
  Char = 1,
}

export interface Style {
  name: string;
  englishName: string;
  kind: StyleKind;
  /** {@link HwpDocument.paraShapes}의 인덱스. */
  paraShapeId: number;
  /** {@link HwpDocument.charShapes}의 인덱스. */
  charShapeId: number;
  /** 끝에서 엔터를 눌러 만들어지는 문단에 적용되는 스타일. */
  nextStyleId: number;
  /** LCID. 예: ko-KR은 1042. */
  langId?: number;
  lockForm?: boolean;
}

// ---------------------------------------------------------------------------
// 바이너리 데이터 (이미지, OLE, 임베드 글꼴)
// ---------------------------------------------------------------------------

export enum BinDataType {
  /** 파일 안 `BinData/` 아래에 저장된다. */
  Embedding = 0,
  /** 외부 경로로 참조한다. */
  Link = 1,
  /** 파일 안에 OLE 저장소로 저장된다. */
  Storage = 2,
}

export enum BinDataCompression {
  Default = 0,
  Compressed = 1,
  Uncompressed = 2,
}

export interface BinDataItem {
  type: BinDataType;
  /** {@link BinDataType.Embedding}일 때 존재한다. 점을 뺀 파일 확장자. 예: `png`, `jpg`, `ole`. */
  extension?: string;
  /** {@link BinDataType.Embedding}과 {@link BinDataType.Storage}일 때 존재한다. */
  data?: Uint8Array;
  /** {@link BinDataType.Link}일 때 존재한다. */
  absolutePath?: string;
  relativePath?: string;
  /** 페이로드가 컨테이너 안에서 deflate 압축돼 있으면 true. */
  compressed?: boolean;
  /** HWPX가 쓰는 안정적인 id(`binaryItemIDRef`). HWP 5를 쓸 때는 유도한다. */
  id?: string;
}
