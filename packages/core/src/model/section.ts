/**
 * 구역 — 쪽 기하와 그 안을 흐르는 문단 스트림.
 */

import type { Rgb } from './color.js'
import type { NumberFormat } from './docinfo.js'
import type { LineStyle } from './docinfo.js'
import type { Paragraph } from './controls.js'
import type { HwpUnit } from './units.js'

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

export interface NoteShape {
  numberFormat: NumberFormat
  prefix?: string
  suffix?: string
  startNumber: number
  numbering: NoteNumbering
  placement: NotePlacement
  /** 구분선 길이, HWPUNIT. `-1`이면 고정 5cm 선. */
  separatorLength?: HwpUnit
  separatorStyle?: LineStyle
  separatorWidth?: number
  separatorColor?: Rgb
  aboveSpacing?: HwpUnit
  belowSpacing?: HwpUnit
  betweenSpacing?: HwpUnit
  /** 주석을 쪽 아래가 아니라 텍스트 바로 뒤에 놓는다. */
  beneathText?: boolean
}

export interface PageBorderFill {
  /** 적용 대상 쪽: 0 = 양쪽, 1 = 짝수, 2 = 홀수. */
  applyTo: number
  /** 테두리를 텍스트 영역이 아니라 용지 가장자리에서 잰다. */
  fromPaperEdge?: boolean
  /** 머리말 / 꼬리말 / 제본 여백을 테두리 안에 포함한다. */
  includeHeader?: boolean
  includeFooter?: boolean
  fillArea?: number
  offsetLeft: HwpUnit
  offsetRight: HwpUnit
  offsetTop: HwpUnit
  offsetBottom: HwpUnit
  borderFillId: number
}

export enum HideKind {
  None = 0,
  Hide = 1,
  Show = 2,
}

export interface SectionProperties {
  /** 구역을 새 쪽 / 홀수 쪽 / 짝수 쪽에서 시작한다. */
  startPageKind?: number
  /** 1쪽에서 머리말, 꼬리말, 쪽 번호, 테두리, 채우기, 배경을 감춘다. */
  hideFirstHeader?: boolean
  hideFirstFooter?: boolean
  hideFirstMasterPage?: boolean
  hideFirstPageBorder?: boolean
  hideFirstPageFill?: boolean
  hideFirstPageNumber?: boolean
  /** 글자 방향: 0 = 가로, 1 = 세로. */
  textDirection?: number
  /** 줄 격자 간격. 끄면 0. */
  lineGrid?: HwpUnit
  charGrid?: HwpUnit
  /** 문단에 명시적 탭 정의가 없을 때 쓰는 탭 정지 간격. */
  defaultTabStop?: HwpUnit
  /** 이 구역의 명시적 시작 번호. */
  startNumbers?: {
    page?: number
    picture?: number
    table?: number
    equation?: number
  }
  /** 이 구역에 적용되는 개요 번호 매기기 id. */
  outlineNumberingId?: number
}

export interface Section {
  pageDef: PageDef
  columnDef?: ColumnDef
  footnoteShape?: NoteShape
  endnoteShape?: NoteShape
  pageBorderFills?: PageBorderFill[]
  properties?: SectionProperties
  paragraphs: Paragraph[]
}
