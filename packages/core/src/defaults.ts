/**
 * 새 문서를 위한 합리적 기본값.
 *
 * 한글이 빈 문서에 대해 만들어내는 것을 그대로 반영한다. A4 용지, 10pt
 * 함초롬바탕, 160% 줄 간격, 그리고 표준 "바탕글" 스타일. 모든 코덱이 각 자원
 * 표의 인덱스 0이 존재한다고 믿어도 된다.
 */

import {
  Align,
  BinDataKind,
  FillKind,
  type BorderFill,
  type CharShape,
  type FontFace,
  FontFamilyKind,
  LineSpacingKind,
  LineStyle,
  LineWidth,
  NO_BORDER,
  NO_FILL,
  type ParaShape,
  type Style,
  StyleKind,
  type TabDef,
  perLang,
} from './model/docinfo.js'
import {
  DEFAULT_DOCUMENT_PROPERTIES,
  DEFAULT_VERSION,
  type HwpDocument,
} from './model/document.js'
import { GutterKind, type PageDef, type Section } from './model/section.js'
import { PAPER, mm, pt } from './model/units.js'

/** 한글이 함께 배포하는 글꼴. 문자 체계별 기본 서체로 쓴다. */
export const DEFAULT_FONTS: FontFace[] = [
  { name: '함초롬바탕', kind: FontFamilyKind.Ttf },
  { name: '함초롬돋움', kind: FontFamilyKind.Ttf },
  { name: '맑은 고딕', kind: FontFamilyKind.Ttf },
  { name: '굴림', kind: FontFamilyKind.Ttf },
  { name: '바탕', kind: FontFamilyKind.Ttf },
]

export function defaultCharShape(overrides: Partial<CharShape> = {}): CharShape {
  return {
    fontIds: perLang(0),
    ratios: perLang(100),
    spacings: perLang(0),
    relSizes: perLang(100),
    offsets: perLang(0),
    height: pt(10),
    textColor: 0x000000,
    shadeColor: 0xffffff,
    ...overrides,
  }
}

export function defaultParaShape(overrides: Partial<ParaShape> = {}): ParaShape {
  return {
    align: Align.Justify,
    marginLeft: 0,
    marginRight: 0,
    indent: 0,
    marginTop: 0,
    marginBottom: 0,
    lineSpacing: { kind: LineSpacingKind.Percent, value: 160 },
    tabDefId: 0,
    widowOrphan: true,
    snapToGrid: true,
    autoSpaceLatin: true,
    autoSpaceNumber: true,
    ...overrides,
  }
}

/** 테두리/채우기 0은 "없음"이고 대부분의 셀과 문단이 이걸 참조한다. */
export const DEFAULT_BORDER_FILLS: BorderFill[] = [
  { left: NO_BORDER, right: NO_BORDER, top: NO_BORDER, bottom: NO_BORDER, fill: NO_FILL },
  {
    left: { style: LineStyle.Solid, width: LineWidth.W0_12mm, color: 0x000000 },
    right: { style: LineStyle.Solid, width: LineWidth.W0_12mm, color: 0x000000 },
    top: { style: LineStyle.Solid, width: LineWidth.W0_12mm, color: 0x000000 },
    bottom: { style: LineStyle.Solid, width: LineWidth.W0_12mm, color: 0x000000 },
    fill: NO_FILL,
  },
]

export const DEFAULT_TAB_DEFS: TabDef[] = [
  { autoTabLeft: false, autoTabRight: false, stops: [] },
  { autoTabLeft: true, autoTabRight: true, stops: [] },
]

/** 한글이 빈 문서에 만드는 스타일 목록. 한글 자신의 순서대로. */
const STYLE_NAMES: [korean: string, english: string][] = [
  ['바탕글', 'Normal'],
  ['본문', 'Body'],
  ['개요 1', 'Outline 1'],
  ['개요 2', 'Outline 2'],
  ['개요 3', 'Outline 3'],
  ['개요 4', 'Outline 4'],
  ['개요 5', 'Outline 5'],
  ['개요 6', 'Outline 6'],
  ['개요 7', 'Outline 7'],
  ['쪽 번호', 'Page Number'],
  ['머리말', 'Header'],
  ['각주', 'Footnote'],
  ['미주', 'Endnote'],
  ['메모', 'Memo'],
  ['차례 제목', 'TOC Heading'],
  ['차례 1', 'TOC 1'],
  ['차례 2', 'TOC 2'],
  ['차례 3', 'TOC 3'],
  ['그림 캡션', 'Figure Caption'],
  ['표 캡션', 'Table Caption'],
]

export function defaultStyles(): Style[] {
  return STYLE_NAMES.map(([name, englishName]) => ({
    name,
    englishName,
    kind: StyleKind.Paragraph,
    paraShapeId: 0,
    charShapeId: 0,
    nextStyleId: 0,
    langId: 1042,
  }))
}

export function defaultPageDef(overrides: Partial<PageDef> = {}): PageDef {
  return {
    width: PAPER.A4.width,
    height: PAPER.A4.height,
    margins: {
      left: mm(30),
      right: mm(30),
      top: mm(20),
      bottom: mm(15),
      header: mm(15),
      footer: mm(15),
      gutter: 0,
    },
    landscape: false,
    gutterKind: GutterKind.LeftOnly,
    ...overrides,
  }
}

export function defaultSection(overrides: Partial<Section> = {}): Section {
  return {
    pageDef: defaultPageDef(),
    properties: { defaultTabStop: pt(40) },
    paragraphs: [],
    ...overrides,
  }
}

/**
 * 비어 있지만 완전한 문서를 만든다. 모든 자원 표가 코덱이 존재한다고 가정해도
 * 되는 항목으로 채워진다.
 */
export function createDocument(overrides: Partial<HwpDocument> = {}): HwpDocument {
  const doc: HwpDocument = {
    version: { ...DEFAULT_VERSION },
    meta: {},
    properties: { ...DEFAULT_DOCUMENT_PROPERTIES },
    fonts: DEFAULT_FONTS.map((f) => ({ ...f })),
    charShapes: [defaultCharShape()],
    paraShapes: [defaultParaShape()],
    borderFills: DEFAULT_BORDER_FILLS.map((b) => ({ ...b })),
    styles: defaultStyles(),
    numberings: [],
    bullets: [],
    tabDefs: DEFAULT_TAB_DEFS.map((t) => ({ ...t, stops: [...t.stops] })),
    binData: [],
    sections: [defaultSection({ paragraphs: [] })],
    ...overrides,
  }
  return doc
}

export { BinDataKind, FillKind }
