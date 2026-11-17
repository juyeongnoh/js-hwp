/**
 * 구역 — 쪽 기하와 그 안을 흐르는 문단 스트림.
 */

import type { Rgb } from './color.js'
import type { NumberFormat } from './docinfo.js'
import type { LineStyle } from './docinfo.js'
import type { ListHeaderRest, Paragraph } from './controls.js'
import type { HalfHwpUnit, HwpUnit } from './units.js'

export interface PageMargins {
  left: HwpUnit
  right: HwpUnit
  top: HwpUnit
  bottom: HwpUnit
  /** 용지 위쪽에서 머리말까지의 거리. */
  header: HwpUnit
  /** 용지 아래쪽에서 꼬리말까지의 거리. */
  footer: HwpUnit
  /** 제본 여백. */
  gutter: HwpUnit
}

export enum GutterKind {
  LeftOnly = 0,
  LeftRight = 1,
  TopBottom = 2,
}

export interface PageDef {
  width: HwpUnit
  height: HwpUnit
  margins: PageMargins
  landscape: boolean
  gutterKind: GutterKind
  /** 속성(표 132)에서 모델이 해석하지 않는 비트(bit 3 이상). 쓸 때 OR로 합친다. */
  unknownBits?: number
}

export enum ColumnKind {
  Normal = 0,
  Distribute = 1,
  Parallel = 2,
}

export enum ColumnDirection {
  Left = 0,
  Right = 1,
  Both = 2,
}

export interface ColumnDef {
  count: number
  kind: ColumnKind
  direction?: ColumnDirection
  /** 단이 같은 너비일 때 단 사이 간격. */
  gap?: HwpUnit
  /** 너비가 다른 배치를 위한 단별 명시적 너비와 간격. */
  columns?: { width: HwpUnit; gap: HwpUnit }[]
  sameWidth?: boolean
  /** 단 사이에 그리는 구분선. */
  separator?: { style: LineStyle; width: number; color: Rgb }
}

export enum NotePlacement {
  /** 쪽 아래(각주) / 문서 끝(미주). */
  EachColumn = 0,
  MergedColumn = 1,
  RightMostColumn = 2,
}

export enum NoteNumbering {
  Continuous = 0,
  RestartEachSection = 1,
  RestartEachPage = 2,
}

/**
 * 각주/미주 모양(표 133). 속성 비트의 뜻은 명세(표 134)를 따랐고 한글로 확인하지 않았다.
 * 저장소 샘플의 속성은 모두 0이었다(정오표 E23).
 */
export interface NoteShape {
  numberFormat: NumberFormat
  /** 번호 모양이 사용자 지정 문자 반복(0x81)일 때의 문자. */
  userChar?: string
  prefix?: string
  suffix?: string
  startNumber: number
  numbering: NoteNumbering
  placement: NotePlacement
  /** 번호를 위 첨자로 쓴다. */
  superscript?: boolean
  /** 주석을 쪽 아래가 아니라 텍스트 바로 뒤에 놓는다. */
  beneathText?: boolean
  /** 속성에서 모델이 해석하지 않는 비트(bit 14 이상). 쓸 때 OR로 합친다. */
  unknownBits?: number
  /** 구분선 길이(4바이트, 정오표 59). 한글은 각주에 -1, 미주에 14692344 또는 0을 쓴다. */
  separatorLength: number
  separatorStyle: LineStyle
  separatorWidth: number
  separatorColor: Rgb
  aboveSpacing: HwpUnit
  belowSpacing: HwpUnit
  betweenSpacing: HwpUnit
}

/**
 * 쪽 테두리/배경(표 135). 한글은 구역마다 양쪽, 짝수 쪽, 홀수 쪽 순서로 세 개를 저장한다.
 * 속성 비트 0~4는 한글로 확인했다(정오표 66, 67).
 */
export interface PageBorderFill {
  /** 위치를 쪽 기준으로 잰다. 아니면 종이 기준이다. 명세 표 136과 반대다(정오표 66). */
  relativeToPage?: boolean
  /** 머리말 / 꼬리말을 테두리 안에 포함한다. 쪽 기준일 때만 고를 수 있다. */
  includeHeader?: boolean
  includeFooter?: boolean
  /** 채울 영역: 0 = 종이, 1 = 쪽, 2 = 테두리. */
  fillArea: number
  /**
   * 속성에서 모델이 해석하지 않는 비트(bit 5 이상). 쓸 때 OR로 합친다.
   * 한글이 초기화하지 않은 값을 쓰는 파일이 있어 버리면 안 된다(정오표 61).
   */
  unknownBits?: number
  offsetLeft: HwpUnit
  offsetRight: HwpUnit
  offsetTop: HwpUnit
  offsetBottom: HwpUnit
  /** {@link HwpDocument.borderFills}의 인덱스. 없으면 테두리/배경 없음. */
  borderFillId?: number
}

/** 구역의 시작 쪽 번호 종류(표 130 bit 20~21, 정오표 58). */
export enum PageNumberStart {
  /** 앞 구역에 이어서. */
  Continue = 0,
  /** 짝수 쪽에서 시작. */
  Even = 1,
  /** 홀수 쪽에서 시작. */
  Odd = 2,
  /** {@link SectionProperties.startNumbers}의 `page`로 시작. */
  User = 3,
}

/** 구역 정의(표 129). 이름 붙인 비트는 한글 구역 설정으로 확인한 것뿐이다(정오표 E23). */
export interface SectionProperties {
  /** 첫 쪽에서 머리말, 꼬리말, 바탕쪽, 테두리, 배경을 감춘다(bit 0~4). */
  hideFirstHeader?: boolean
  hideFirstFooter?: boolean
  hideFirstMasterPage?: boolean
  hideFirstPageBorder?: boolean
  hideFirstPageFill?: boolean
  /** 빈 줄 감추기(bit 19). */
  hideEmptyLines?: boolean
  pageNumberStart?: PageNumberStart
  /**
   * 속성에서 모델이 해석하지 않는 비트. 쓸 때 OR로 합친다. 명세가 쪽 번호 위치 감추기(bit 5),
   * 첫 쪽에만 테두리/배경 표시(bit 8~9), 텍스트 방향(bit 16~18), 원고지 정서법(bit 22)이라고
   * 적은 비트도 확인 전까지 여기 둔다.
   */
  unknownBits?: number
  /** 단 사이 간격. */
  columnSpacing?: HwpUnit
  /** 세로 줄맞춤 간격. 끄면 0. */
  lineGrid?: HwpUnit
  /** 가로 줄맞춤 간격. 끄면 0. */
  charGrid?: HwpUnit
  /** 문단에 명시적 탭 정의가 없을 때 쓰는 탭 간격. 한글은 HWPUNIT의 2배로 저장한다(정오표 54). */
  defaultTabStop?: HalfHwpUnit
  /** 이 구역의 명시적 시작 번호. 없으면 앞 구역에 이어서. */
  startNumbers?: {
    /** {@link pageNumberStart}가 `User`일 때의 쪽 번호. */
    page?: number
    picture?: number
    table?: number
    equation?: number
  }
  /** {@link HwpDocument.numberings}의 인덱스. 없으면 번호 문단 모양 없음. */
  outlineNumberingId?: number
  /** 대표 언어(5.0.1.5 이상). 0이면 응용 프로그램의 언어. */
  language?: number
  /** 알려진 필드 뒤의 바이트(5.0.2.5는 8B, 5.0.4.0 이상은 17B). 쓸 때 끝에 그대로 붙인다. */
  trailing?: Uint8Array
}

/**
 * 바탕쪽. `secd` 아래에 쪽 테두리/배경 다음으로 LIST_HEADER와 형제 문단으로 온다(정오표 68).
 * LIST_HEADER의 텍스트 영역 폭·높이 등(표 137)은 아직 해석하지 않고 `listHeaderRest`로 보존한다.
 */
export interface MasterPage extends ListHeaderRest {
  paragraphs: Paragraph[]
}

export interface Section {
  pageDef: PageDef
  columnDef?: ColumnDef
  footnoteShape?: NoteShape
  endnoteShape?: NoteShape
  pageBorderFills?: PageBorderFill[]
  masterPages?: MasterPage[]
  properties?: SectionProperties
  paragraphs: Paragraph[]
}
