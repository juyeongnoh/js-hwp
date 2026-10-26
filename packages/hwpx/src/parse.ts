/**
 * HWPX 읽기.
 *
 * `.hwpx` 패키지를 공유 문서 모델로 읽는다. 일부러 관대하게 만들었다. 실제
 * 파일은 여러 한글 버전과 서드파티 라이터에서 오고, 요소를 빠뜨리거나 순서를
 * 바꾸거나 가끔 `META-INF/manifest.xml`을 통째로 건너뛴다. 없는 것은 불러오기를
 * 실패시키는 대신 문서 기본값으로 물러난다.
 *
 */

import {
  Align,
  type BinDataItem,
  BinDataType,
  type BorderFill,
  type BorderLine,
  type CharShape,
  type Control,
  type FontFace,
  FillKind,
  type HwpDocument,
  type InlineItem,
  type Numbering,
  type ParaShape,
  type Paragraph,
  type Run,
  type Section,
  type Style,
  StrikeoutKind,
  type TabDef,
  type TableCell,
  type TableRow,
  createDocument,
  defaultCharShape,
  defaultPageDef,
  defaultParaShape,
  perLang,
} from "@js-hwp/core";
import { unzipSync } from "fflate";
import {
  ENTRY,
  HEADING_TYPE,
  HORIZONTAL_ALIGN,
  LANG_ATTRS,
  LINE_SPACING_TYPE,
  LINE_TYPE,
  NUMBER_FORMAT_NAMES,
  PAGE_DIRECTION,
  TABLE_PAGE_BREAK,
  CELL_VERTICAL_ALIGN_FROM_WIRE,
  UNDERLINE_TYPE,
  VERTICAL_ALIGN,
  enumIndex,
  lineWidthIndex,
  parseColorAttr,
} from "./constants.js";
import {
  attr,
  boolAttr,
  child,
  children,
  descendants,
  numAttr,
  parseXml,
  path,
  textContent,
  type XmlElement,
} from "./xml.js";

export class HwpxError extends Error {
  override name = "HwpxError";
}

export interface ParseHwpxOptions {
  /** 임베드된 바이너리를 메모리에 유지한다. 기본값 `true`. */
  loadBinData?: boolean;
}

const decoder = new TextDecoder("utf-8");

/** `.hwpx` 패키지를 문서 모델로 파싱한다. */
export function parseHwpx(
  data: Uint8Array,
  options: ParseHwpxOptions = {},
): HwpDocument {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch (error) {
    throw new HwpxError(
      `Not a valid HWPX package: ${(error as Error).message}`,
    );
  }

  const readText = (name: string): string | undefined => {
    const bytes = entries[name];
    return bytes ? stripBom(decoder.decode(bytes)) : undefined;
  };

  const headerXml = readText(ENTRY.header);
  if (!headerXml) {
    throw new HwpxError(`HWPX package has no ${ENTRY.header}`);
  }

  const doc = createDocument({
    fonts: [],
    charShapes: [],
    paraShapes: [],
    borderFills: [],
    styles: [],
    numberings: [],
    tabDefs: [],
    sections: [],
  });

  const versionXml = readText(ENTRY.version);
  if (versionXml) applyVersion(doc, parseXml(versionXml));

  const contentXml = readText(ENTRY.contentHpf);
  if (contentXml) applyMetadata(doc, parseXml(contentXml));

  applyHeader(doc, parseXml(headerXml));

  if (options.loadBinData !== false) {
    for (const [name, bytes] of Object.entries(entries)) {
      if (!name.startsWith("BinData/")) continue;
      const file = name.slice("BinData/".length);
      const dot = file.lastIndexOf(".");
      const item: BinDataItem = {
        type: BinDataType.Embedding,
        extension: dot === -1 ? "bin" : file.slice(dot + 1),
        data: bytes,
        id: dot === -1 ? file : file.slice(0, dot),
      };
      doc.binData.push(item);
    }
  }

  // 구역은 `Contents/section0.xml`, `section1.xml`, … 순서다.
  const sectionNames = Object.keys(entries)
    .filter((name) => /^Contents\/section\d+\.xml$/.test(name))
    .sort((a, b) => sectionNumber(a) - sectionNumber(b));

  for (const name of sectionNames) {
    const xml = readText(name);
    if (!xml) continue;
    doc.sections.push(parseSection(doc, parseXml(xml)));
  }

  if (doc.sections.length === 0) {
    doc.sections.push({ pageDef: defaultPageDef(), paragraphs: [] });
  }
  ensureNonEmpty(doc);

  const settingsXml = readText(ENTRY.settings);
  if (settingsXml) applySettings(doc, parseXml(settingsXml));

  doc.preview = readText(ENTRY.previewText);
  return doc;
}

/** 싼 포맷 판별: `mimetype` 엔트리가 HWPX라고 말하는 ZIP. */
export function isHwpx(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  if (data[0] !== 0x50 || data[1] !== 0x4b) return false;
  try {
    const entries = unzipSync(data, {
      filter: (f) => f.name === ENTRY.mimetype || f.name === ENTRY.header,
    });
    const mimetype = entries[ENTRY.mimetype];
    if (mimetype)
      return decoder.decode(mimetype).trim() === "application/hwp+zip";
    return entries[ENTRY.header] !== undefined;
  } catch {
    return false;
  }
}

const sectionNumber = (name: string): number =>
  Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);

const stripBom = (value: string): string =>
  value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;

function ensureNonEmpty(doc: HwpDocument): void {
  if (doc.fonts.length === 0) doc.fonts.push({ name: "함초롬바탕" });
  if (doc.charShapes.length === 0) doc.charShapes.push(defaultCharShape());
  if (doc.paraShapes.length === 0) doc.paraShapes.push(defaultParaShape());
  if (doc.borderFills.length === 0) {
    doc.borderFills.push({
      left: noBorder(),
      right: noBorder(),
      top: noBorder(),
      bottom: noBorder(),
      fill: { kind: FillKind.None },
    });
  }
  for (const section of doc.sections) {
    if (section.paragraphs.length === 0) {
      section.paragraphs.push({
        paraShapeId: 0,
        styleId: 0,
        runs: [{ charShapeId: 0, items: [] }],
      });
    }
  }
}

const noBorder = (): BorderLine => ({ style: 0, width: 0, color: 0 });

// ---------------------------------------------------------------------------
// 패키지 파트
// ---------------------------------------------------------------------------

function applyVersion(doc: HwpDocument, root: XmlElement): void {
  doc.version = {
    major: numAttr(root, "major", 5),
    minor: numAttr(root, "minor", 0),
    build: numAttr(root, "micro", 0),
    revision: numAttr(root, "buildNumber", 0),
  };
}

function applyMetadata(doc: HwpDocument, root: XmlElement): void {
  const metadata = child(root, "opf:metadata");
  if (!metadata) return;

  doc.meta.title = textContent(child(metadata, "opf:title")) || undefined;
  doc.meta.language = textContent(child(metadata, "opf:language")) || undefined;

  for (const meta of children(metadata, "opf:meta")) {
    const value = textContent(meta);
    if (!value) continue;
    switch (attr(meta, "name")) {
      case "creator":
        doc.meta.author = value;
        doc.meta.creator = value;
        break;
      case "subject":
        doc.meta.subject = value;
        break;
      case "description":
        doc.meta.description = value;
        break;
      case "lastsaveby":
        doc.meta.lastSavedBy = value;
        break;
      case "CreatedDate":
        doc.meta.createdAt = value;
        break;
      case "ModifiedDate":
        doc.meta.modifiedAt = value;
        break;
      case "keyword":
        doc.meta.keywords = value.split(/\s*,\s*/).filter(Boolean);
        break;
      default:
        break;
    }
  }
}

function applySettings(doc: HwpDocument, root: XmlElement): void {
  const caret = child(root, "ha:CaretPosition");
  if (!caret) return;
  doc.properties.caret = {
    list: numAttr(caret, "listIDRef"),
    paragraph: numAttr(caret, "paraIDRef"),
    position: numAttr(caret, "pos"),
  };
}

// ---------------------------------------------------------------------------
// header.xml
// ---------------------------------------------------------------------------

function applyHeader(doc: HwpDocument, root: XmlElement): void {
  const begin = child(root, "hh:beginNum");
  if (begin) {
    doc.properties = {
      startPage: numAttr(begin, "page", 1),
      startFootnote: numAttr(begin, "footnote", 1),
      startEndnote: numAttr(begin, "endnote", 1),
      startPicture: numAttr(begin, "pic", 1),
      startTable: numAttr(begin, "tbl", 1),
      startEquation: numAttr(begin, "equation", 1),
    };
  }

  const refList = child(root, "hh:refList");
  if (!refList) return;

  parseFonts(doc, refList);
  parseBorderFills(doc, refList);
  parseCharShapes(doc, refList);
  parseTabDefs(doc, refList);
  parseNumberings(doc, refList);
  parseParaShapes(doc, refList);
  parseStyles(doc, refList);

  const compatible = child(root, "hh:compatibleDocument");
  if (compatible) {
    doc.compatibility = {
      targetProgram: ["HWP201X", "MSWORD", "HWP200X"].indexOf(
        attr(compatible, "targetProgram") ?? "",
      ),
    };
  }
}

/**
 * 글꼴은 문자 체계별로 묶이고 각 묶음이 0부터 번호를 매긴다. 모델은 평평한 표
 * 하나를 유지하므로 한글 묶음이 그걸 정하고 다른 묶음은 자기가 더하는 글꼴만
 * 기여한다.
 */
function parseFonts(doc: HwpDocument, refList: XmlElement): void {
  const groups = children(child(refList, "hh:fontfaces"), "hh:fontface");
  if (groups.length === 0) return;

  const hangul = groups.find((g) => attr(g, "lang") === "HANGUL") ?? groups[0]!;
  const fonts: FontFace[] = [];
  const byName = new Map<string, number>();

  const add = (element: XmlElement): number => {
    const name = attr(element, "face") ?? "";
    const existing = byName.get(name);
    if (existing !== undefined) return existing;

    const typeInfo = child(element, "hh:typeInfo");
    const face: FontFace = {
      name,
      kind: attr(element, "type") === "HFT" ? 2 : 1,
      typeInfo: typeInfo
        ? {
            fontFamily: 0,
            serifStyle: 0,
            weight: numAttr(typeInfo, "weight"),
            proportion: numAttr(typeInfo, "proportion"),
            contrast: numAttr(typeInfo, "contrast"),
            strokeVariation: numAttr(typeInfo, "strokeVariation"),
            armStyle: numAttr(typeInfo, "armStyle"),
            letterform: numAttr(typeInfo, "letterform"),
            midline: numAttr(typeInfo, "midline"),
            xHeight: numAttr(typeInfo, "xHeight"),
          }
        : undefined,
    };
    const substitute = child(element, "hh:substFont");
    if (substitute) {
      face.substituteFont = { name: attr(substitute, "face") ?? "", kind: 1 };
    }
    fonts.push(face);
    byName.set(name, fonts.length - 1);
    return fonts.length - 1;
  };

  for (const font of children(hangul, "hh:font")) add(font);
  for (const group of groups) {
    if (group === hangul) continue;
    for (const font of children(group, "hh:font")) add(font);
  }

  doc.fonts = fonts;
}

function parseBorderLine(element: XmlElement | undefined): BorderLine {
  return {
    style: enumIndex(LINE_TYPE, attr(element, "type")),
    width: lineWidthIndex(attr(element, "width")),
    color: parseColorAttr(attr(element, "color")),
  };
}

function parseBorderFills(doc: HwpDocument, refList: XmlElement): void {
  const list = children(child(refList, "hh:borderFills"), "hh:borderFill");
  doc.borderFills = list.map((element) => {
    const fill: BorderFill = {
      left: parseBorderLine(child(element, "hh:leftBorder")),
      right: parseBorderLine(child(element, "hh:rightBorder")),
      top: parseBorderLine(child(element, "hh:topBorder")),
      bottom: parseBorderLine(child(element, "hh:bottomBorder")),
      fill: { kind: FillKind.None },
      threeD: boolAttr(element, "threeD"),
      shadow: boolAttr(element, "shadow"),
      breakCellSeparateLine: boolAttr(element, "breakCellSeparateLine"),
    };

    const brush = child(element, "hc:fillBrush");
    const win = child(brush, "hc:winBrush");
    if (win) {
      const background = attr(win, "faceColor");
      if (background && background !== "none") {
        fill.fill = {
          kind: FillKind.Color,
          background: parseColorAttr(background),
          alpha: Math.round(numAttr(win, "alpha") * 100),
        };
      }
    }

    const gradation = child(brush, "hc:gradation");
    if (gradation) {
      fill.fill = {
        kind: FillKind.Gradient,
        type: Math.max(
          1,
          ["", "LINEAR", "RADIAL", "CONICAL", "SQUARE"].indexOf(
            attr(gradation, "type") ?? "LINEAR",
          ),
        ),
        angle: numAttr(gradation, "angle"),
        centerX: numAttr(gradation, "centerX"),
        centerY: numAttr(gradation, "centerY"),
        step: numAttr(gradation, "step"),
        colors: children(gradation, "hc:color").map((c) =>
          parseColorAttr(attr(c, "value")),
        ),
      };
    }

    return fill;
  });
}

const perLangFrom = (
  element: XmlElement | undefined,
  fallback: number,
): [number, number, number, number, number, number, number] => {
  if (!element) return perLang(fallback);
  return LANG_ATTRS.map((lang) => numAttr(element, lang, fallback)) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
};

function parseCharShapes(doc: HwpDocument, refList: XmlElement): void {
  const list = children(child(refList, "hh:charProperties"), "hh:charPr");
  doc.charShapes = list.map((element) => {
    const underline = child(element, "hh:underline");
    const strikeout = child(element, "hh:strikeout");
    const shadow = child(element, "hh:shadow");
    const shade = attr(element, "shadeColor");

    const shape: CharShape = {
      fontIds: perLangFrom(child(element, "hh:fontRef"), 0),
      ratios: perLangFrom(child(element, "hh:ratio"), 100),
      spacings: perLangFrom(child(element, "hh:spacing"), 0),
      relSizes: perLangFrom(child(element, "hh:relSz"), 100),
      offsets: perLangFrom(child(element, "hh:offset"), 0),
      height: numAttr(element, "height", 1000),
      textColor: parseColorAttr(attr(element, "textColor")),
      shadeColor:
        shade === "none" || shade === undefined
          ? 0xffffff
          : parseColorAttr(shade),
      borderFillId: Math.max(0, numAttr(element, "borderFillIDRef", 1) - 1),
      useFontSpace: boolAttr(element, "useFontSpace"),
      useKerning: boolAttr(element, "useKerning"),
    };

    // 한글은 진하게와 기울임을 존재만으로 의미를 갖는 자식 요소로 쓴다.
    if (child(element, "hh:bold")) shape.bold = true;
    if (child(element, "hh:italic")) shape.italic = true;
    if (child(element, "hh:emboss")) shape.emboss = true;
    if (child(element, "hh:engrave")) shape.engrave = true;
    if (child(element, "hh:supscript")) shape.superscript = true;
    if (child(element, "hh:subscript")) shape.subscript = true;

    const underlineType = enumIndex(UNDERLINE_TYPE, attr(underline, "type"));
    if (underlineType !== 0) {
      shape.underline = {
        kind: underlineType,
        style: enumIndex(LINE_TYPE, attr(underline, "shape"), 1),
        color: parseColorAttr(attr(underline, "color")),
      };
    }

    const strikeShape = attr(strikeout, "shape");
    if (strikeShape && strikeShape !== "NONE") {
      shape.strikeout = {
        kind: StrikeoutKind.Continuous,
        style: enumIndex(LINE_TYPE, strikeShape, 1),
        color: parseColorAttr(attr(strikeout, "color")),
      };
    }

    const outlineType = enumIndex(
      LINE_TYPE,
      attr(child(element, "hh:outline"), "type"),
    );
    if (outlineType !== 0) shape.outline = outlineType;

    if (
      shadow &&
      attr(shadow, "type") !== "NONE" &&
      attr(shadow, "type") !== undefined
    ) {
      shape.shadow = {
        kind: 1,
        color: parseColorAttr(attr(shadow, "color"), 0xb2b2b2),
        offsetX: numAttr(shadow, "offsetX", 10),
        offsetY: numAttr(shadow, "offsetY", 10),
      };
    }

    return shape;
  });
}

function parseTabDefs(doc: HwpDocument, refList: XmlElement): void {
  const list = children(child(refList, "hh:tabProperties"), "hh:tabPr");
  doc.tabDefs = list.map(
    (element): TabDef => ({
      autoTabLeft: boolAttr(element, "autoTabLeft"),
      autoTabRight: boolAttr(element, "autoTabRight"),
      stops: children(element, "hh:tabItem").map((item) => ({
        position: numAttr(item, "pos"),
        kind: Math.max(
          0,
          ["LEFT", "RIGHT", "CENTER", "DECIMAL"].indexOf(
            attr(item, "type") ?? "LEFT",
          ),
        ),
        fillStyle: enumIndex(LINE_TYPE, attr(item, "leader")),
      })),
    }),
  );
}

function parseNumberings(doc: HwpDocument, refList: XmlElement): void {
  const list = children(child(refList, "hh:numberings"), "hh:numbering");
  const formats = Object.entries(NUMBER_FORMAT_NAMES);

  doc.numberings = list.map(
    (element): Numbering => ({
      startNumber: numAttr(element, "start", 1),
      levels: children(element, "hh:paraHead").map((head) => ({
        format: textContent(head),
        numberFormat: Number(
          formats.find(([, name]) => name === attr(head, "numFormat"))?.[0] ??
            0,
        ),
        align: enumIndex(HORIZONTAL_ALIGN, attr(head, "align"), Align.Left),
        widthAdjust: numAttr(head, "widthAdjust"),
        distance: numAttr(head, "textOffset", 50),
        distanceIsRatio: attr(head, "textOffsetType") === "PERCENT",
        startNumber: numAttr(head, "start", 1),
      })),
    }),
  );
}

function parseParaShapes(doc: HwpDocument, refList: XmlElement): void {
  const list = children(child(refList, "hh:paraProperties"), "hh:paraPr");
  doc.paraShapes = list.map((element) => {
    const align = child(element, "hh:align");
    const heading = child(element, "hh:heading");
    const breakSetting = child(element, "hh:breakSetting");
    const border = child(element, "hh:border");

    // 최근 한글 버전이 쓴 파일에서는 여백과 줄 간격이 hp:switch 안에 있다.
    // 기본 분기가 같은 값을 담고 있다.
    const margin = findNested(element, "hh:margin");
    const lineSpacing = findNested(element, "hh:lineSpacing");

    const shape: ParaShape = {
      align: enumIndex(
        HORIZONTAL_ALIGN,
        attr(align, "horizontal"),
        Align.Justify,
      ),
      verticalAlign: enumIndex(VERTICAL_ALIGN, attr(align, "vertical")),
      marginLeft: numAttr(child(margin, "hc:left"), "value"),
      marginRight: numAttr(child(margin, "hc:right"), "value"),
      indent: numAttr(child(margin, "hc:intent"), "value"),
      marginTop: numAttr(child(margin, "hc:prev"), "value"),
      marginBottom: numAttr(child(margin, "hc:next"), "value"),
      lineSpacing: {
        kind: enumIndex(LINE_SPACING_TYPE, attr(lineSpacing, "type")),
        value: numAttr(lineSpacing, "value", 160),
      },
      tabDefId: numAttr(element, "tabPrIDRef"),
      condense: numAttr(element, "condense"),
      fontLineHeight: boolAttr(element, "fontLineHeight"),
      snapToGrid: boolAttr(element, "snapToGrid", true),
      widowOrphan: boolAttr(breakSetting, "widowOrphan"),
      keepWithNext: boolAttr(breakSetting, "keepWithNext"),
      keepLines: boolAttr(breakSetting, "keepLines"),
      pageBreakBefore: boolAttr(breakSetting, "pageBreakBefore"),
      lineBreakLatin:
        attr(breakSetting, "breakLatinWord") === "BREAK_WORD" ? 2 : 0,
      lineBreakHangul:
        attr(breakSetting, "breakNonLatinWord") === "BREAK_WORD" ? 1 : 0,
      autoSpaceLatin: boolAttr(child(element, "hh:autoSpacing"), "eAsianEng"),
      autoSpaceNumber: boolAttr(child(element, "hh:autoSpacing"), "eAsianNum"),
    };

    const headingType = enumIndex(HEADING_TYPE, attr(heading, "type"));
    if (headingType !== 0) {
      shape.headingKind = headingType;
      shape.headingId = Math.max(0, numAttr(heading, "idRef", 1) - 1);
      shape.headingLevel = numAttr(heading, "level");
    }

    if (border) {
      shape.border = {
        borderFillId: Math.max(0, numAttr(border, "borderFillIDRef", 1) - 1),
        offsetLeft: numAttr(border, "offsetLeft"),
        offsetRight: numAttr(border, "offsetRight"),
        offsetTop: numAttr(border, "offsetTop"),
        offsetBottom: numAttr(border, "offsetBottom"),
        connect: boolAttr(border, "connect"),
        ignoreMargin: boolAttr(border, "ignoreMargin"),
      };
    }

    return shape;
  });
}

/** 이름으로 자식을 찾되 `hp:switch` 감싸개를 꿰뚫어 본다. */
function findNested(element: XmlElement, name: string): XmlElement | undefined {
  const direct = child(element, name);
  if (direct) return direct;
  const branch =
    path(element, "hp:switch", "hp:default") ??
    path(element, "hp:switch", "hp:case");
  return child(branch, name);
}

function parseStyles(doc: HwpDocument, refList: XmlElement): void {
  const list = children(child(refList, "hh:styles"), "hh:style");
  doc.styles = list.map(
    (element): Style => ({
      name: attr(element, "name") ?? "",
      englishName: attr(element, "engName") ?? "",
      kind: attr(element, "type") === "CHAR" ? 1 : 0,
      paraShapeId: numAttr(element, "paraPrIDRef"),
      charShapeId: numAttr(element, "charPrIDRef"),
      nextStyleId: numAttr(element, "nextStyleIDRef"),
      langId: numAttr(element, "langID", 1042),
      lockForm: boolAttr(element, "lockForm"),
    }),
  );
}

// ---------------------------------------------------------------------------
// section{N}.xml
// ---------------------------------------------------------------------------

function parseSection(doc: HwpDocument, root: XmlElement): Section {
  const section: Section = { pageDef: defaultPageDef(), paragraphs: [] };

  const secPr = descendants(root, "hp:secPr")[0];
  if (secPr) applySectionProperties(section, secPr);

  const colPr = descendants(root, "hp:colPr")[0];
  if (colPr) {
    const count = numAttr(colPr, "colCount", 1);
    if (count > 1) {
      section.columnDef = {
        count,
        kind: 0,
        sameWidth: boolAttr(colPr, "sameSz", true),
        gap: numAttr(colPr, "sameGap"),
      };
    }
  }

  for (const element of children(root, "hp:p")) {
    section.paragraphs.push(parseParagraph(doc, element));
  }
  return section;
}

function applySectionProperties(section: Section, secPr: XmlElement): void {
  const pagePr = child(secPr, "hp:pagePr");
  if (pagePr) {
    const margin = child(pagePr, "hp:margin");
    section.pageDef = {
      width: numAttr(pagePr, "width", section.pageDef.width),
      height: numAttr(pagePr, "height", section.pageDef.height),
      // NARROWLY가 가로, WIDELY가 세로다.
      landscape: attr(pagePr, "landscape") === PAGE_DIRECTION.landscape,
      gutterKind: Math.max(
        0,
        ["LEFT_ONLY", "LEFT_RIGHT", "TOP_BOTTOM"].indexOf(
          attr(pagePr, "gutterType") ?? "LEFT_ONLY",
        ),
      ),
      margins: {
        left: numAttr(margin, "left"),
        right: numAttr(margin, "right"),
        top: numAttr(margin, "top"),
        bottom: numAttr(margin, "bottom"),
        header: numAttr(margin, "header"),
        footer: numAttr(margin, "footer"),
        gutter: numAttr(margin, "gutter"),
      },
    };
  }

  const grid = child(secPr, "hp:grid");
  const startNum = child(secPr, "hp:startNum");
  const visibility = child(secPr, "hp:visibility");
  section.properties = {
    defaultTabStop: numAttr(secPr, "tabStopVal", 4000),
    lineGrid: numAttr(grid, "lineGrid"),
    charGrid: numAttr(grid, "charGrid"),
    startNumbers: {
      page: numAttr(startNum, "page"),
      picture: numAttr(startNum, "pic"),
      table: numAttr(startNum, "tbl"),
      equation: numAttr(startNum, "equation"),
    },
    hideFirstHeader: boolAttr(visibility, "hideFirstHeader"),
    hideFirstFooter: boolAttr(visibility, "hideFirstFooter"),
    hideFirstMasterPage: boolAttr(visibility, "hideFirstMasterPage"),
    hideFirstPageNumber: boolAttr(visibility, "hideFirstPageNum"),
  };
}

function parseParagraph(doc: HwpDocument, element: XmlElement): Paragraph {
  const paragraph: Paragraph = {
    paraShapeId: numAttr(element, "paraPrIDRef"),
    styleId: numAttr(element, "styleIDRef"),
    runs: [],
  };
  const id = numAttr(element, "id", -1);
  if (id >= 0) paragraph.id = id;
  if (boolAttr(element, "pageBreak")) paragraph.pageBreak = true;
  if (boolAttr(element, "columnBreak")) paragraph.columnBreak = true;
  if (boolAttr(element, "merged")) paragraph.merged = true;

  for (const runElement of children(element, "hp:run")) {
    const run: Run = {
      charShapeId: numAttr(runElement, "charPrIDRef"),
      items: [],
    };
    for (const node of runElement.children) {
      if (node.type !== "element") continue;
      collectRunItems(doc, node, run.items);
    }
    paragraph.runs.push(run);
  }

  if (paragraph.runs.length === 0)
    paragraph.runs.push({ charShapeId: 0, items: [] });
  return paragraph;
}

function collectRunItems(
  doc: HwpDocument,
  element: XmlElement,
  out: InlineItem[],
): void {
  switch (element.name) {
    case "hp:t": {
      // <hp:t>는 텍스트와 <hp:tab/>, <hp:lineBreak/> 같은 표시를 섞는다.
      for (const node of element.children) {
        if (node.type === "text") {
          if (node.value !== "") out.push({ type: "text", value: node.value });
          continue;
        }
        switch (node.name) {
          case "hp:tab":
            out.push({
              type: "tab",
              width: numAttr(node, "width") || undefined,
            });
            break;
          case "hp:lineBreak":
            out.push({ type: "lineBreak" });
            break;
          case "hp:nbSpace":
            out.push({ type: "specialChar", char: "nbsp" });
            break;
          case "hp:fwSpace":
            out.push({ type: "specialChar", char: "fixedWidthSpace" });
            break;
          case "hp:hyphen":
            out.push({ type: "specialChar", char: "hyphen" });
            break;
          case "hp:titleMark":
            out.push({ type: "specialChar", char: "titleMark" });
            break;
          default:
            break;
        }
      }
      return;
    }
    case "hp:tbl":
      out.push(parseTable(doc, element));
      return;
    case "hp:pic":
      out.push(parsePicture(doc, element));
      return;
    case "hp:equation":
      out.push({
        type: "equation",
        placement: emptyPlacement(element),
        script: textContent(child(element, "hp:script")),
        baseLine: numAttr(element, "baseLine", 85),
        charSize: numAttr(element, "baseUnit", 1000),
      });
      return;
    case "hp:header":
    case "hp:footer":
      out.push({
        type: element.name === "hp:header" ? "header" : "footer",
        applyTo: Math.max(
          0,
          ["BOTH", "EVEN", "ODD"].indexOf(
            attr(element, "applyPageType") ?? "BOTH",
          ),
        ),
        paragraphs: children(child(element, "hp:subList"), "hp:p").map((p) =>
          parseParagraph(doc, p),
        ),
      });
      return;
    case "hp:footNote":
    case "hp:endNote":
      out.push({
        type: element.name === "hp:footNote" ? "footnote" : "endnote",
        paragraphs: children(child(element, "hp:subList"), "hp:p").map((p) =>
          parseParagraph(doc, p),
        ),
      });
      return;
    case "hp:ctrl":
      for (const node of element.children) {
        if (node.type === "element") collectControl(node, out);
      }
      return;
    case "hp:secPr":
    case "hp:linesegarray":
      // 구역 설정은 따로 읽는다. 라인 세그먼트는 한글이 다시 계산하는 레이아웃
      // 캐시라 보관할 게 없다.
      return;
    default:
      return;
  }
}

function collectControl(element: XmlElement, out: InlineItem[]): void {
  switch (element.name) {
    case "hp:bookmark":
      out.push({ type: "bookmark", name: attr(element, "name") ?? "" });
      return;
    case "hp:fieldBegin": {
      const command = descendants(element, "hp:stringParam")
        .map((param) => textContent(param))
        .find((value) => value !== "");
      const typeName = attr(element, "type") ?? "";
      out.push({
        type: "fieldBegin",
        fieldKind: fieldKindFromName(typeName),
        id: numAttr(element, "id"),
        name: attr(element, "name") || undefined,
        command,
        editable: boolAttr(element, "editable", true),
      });
      return;
    }
    case "hp:fieldEnd":
      out.push({ type: "fieldEnd", id: numAttr(element, "beginIDRef") });
      return;
    case "hp:colPr":
      return;
    case "hp:autoNum":
      out.push({
        type: "autoNumber",
        numberKind: Math.max(
          0,
          [
            "PAGE",
            "FOOTNOTE",
            "ENDNOTE",
            "PICTURE",
            "TABLE",
            "EQUATION",
            "TOTAL_PAGE",
          ].indexOf(attr(element, "numType") ?? "PAGE"),
        ),
        numberFormat: 0,
      });
      return;
    case "hp:pageNum":
      out.push({
        type: "pageNumberPosition",
        position: numAttr(element, "pos"),
        numberFormat: 0,
        prefix: attr(element, "sideChar") || undefined,
      });
      return;
    default:
      return;
  }
}

const FIELD_KINDS: Record<string, number> = {
  DATE: 1,
  DOCDATE: 2,
  PATH: 3,
  BOOKMARK: 4,
  MAILMERGE: 5,
  CROSSREF: 6,
  FORMULA: 7,
  CLICKHERE: 8,
  SUMMARY: 9,
  USERINFO: 10,
  HYPERLINK: 11,
  MEMO: 22,
  TABLEOFCONTENTS: 24,
};

const fieldKindFromName = (name: string): number => FIELD_KINDS[name] ?? 0;

function emptyPlacement(
  element: XmlElement,
): Control extends { placement: infer P } ? P : never {
  const size = child(element, "hp:sz");
  const pos = child(element, "hp:pos");
  const outMargin = child(element, "hp:outMargin");
  const REL = ["PAPER", "PAGE", "COLUMN", "PARA"];

  return {
    treatAsChar: boolAttr(pos, "treatAsChar", true),
    flowWithText: boolAttr(pos, "flowWithText", true),
    allowOverlap: boolAttr(pos, "allowOverlap"),
    vertRelTo: Math.max(0, REL.indexOf(attr(pos, "vertRelTo") ?? "PARA")),
    horzRelTo: Math.max(0, REL.indexOf(attr(pos, "horzRelTo") ?? "COLUMN")),
    offsetX: numAttr(pos, "horzOffset"),
    offsetY: numAttr(pos, "vertOffset"),
    width: numAttr(size, "width"),
    height: numAttr(size, "height"),
    zOrder: numAttr(element, "zOrder"),
    marginLeft: numAttr(outMargin, "left"),
    marginRight: numAttr(outMargin, "right"),
    marginTop: numAttr(outMargin, "top"),
    marginBottom: numAttr(outMargin, "bottom"),
  } as never;
}

function parseTable(doc: HwpDocument, element: XmlElement): Control {
  const inMargin = child(element, "hp:inMargin");
  const cellMargins = {
    left: numAttr(inMargin, "left"),
    right: numAttr(inMargin, "right"),
    top: numAttr(inMargin, "top"),
    bottom: numAttr(inMargin, "bottom"),
  };

  const rows: TableRow[] = children(element, "hp:tr").map((tr) => ({
    cells: children(tr, "hp:tc").map((tc): TableCell => {
      const addr = child(tc, "hp:cellAddr");
      const span = child(tc, "hp:cellSpan");
      const size = child(tc, "hp:cellSz");
      const margin = child(tc, "hp:cellMargin");
      const subList = child(tc, "hp:subList");

      return {
        col: numAttr(addr, "colAddr"),
        row: numAttr(addr, "rowAddr"),
        colSpan: Math.max(1, numAttr(span, "colSpan", 1)),
        rowSpan: Math.max(1, numAttr(span, "rowSpan", 1)),
        width: numAttr(size, "width"),
        height: numAttr(size, "height"),
        margins: boolAttr(tc, "hasMargin")
          ? {
              left: numAttr(margin, "left"),
              right: numAttr(margin, "right"),
              top: numAttr(margin, "top"),
              bottom: numAttr(margin, "bottom"),
            }
          : undefined,
        borderFillId: Math.max(0, numAttr(tc, "borderFillIDRef", 1) - 1),
        verticalAlign:
          CELL_VERTICAL_ALIGN_FROM_WIRE[
            Math.max(
              0,
              ["TOP", "CENTER", "BOTTOM"].indexOf(
                attr(subList, "vertAlign") ?? "TOP",
              ),
            )
          ] ?? 1,
        header: boolAttr(tc, "header"),
        paragraphs: children(subList, "hp:p").map((p) =>
          parseParagraph(doc, p),
        ),
      };
    }),
  }));

  return {
    type: "table",
    placement: emptyPlacement(element),
    rows,
    cellMargins,
    cellSpacing: numAttr(element, "cellSpacing"),
    borderFillId: Math.max(0, numAttr(element, "borderFillIDRef", 1) - 1),
    repeatHeaderRows: boolAttr(element, "repeatHeader") ? 1 : 0,
    // 이름으로 대응시킨다. HWPX와 바이너리 포맷이 이걸 반대로 놓는다.
    pageBreak: Math.max(
      0,
      TABLE_PAGE_BREAK.indexOf(
        (attr(element, "pageBreak") ??
          "CELL") as (typeof TABLE_PAGE_BREAK)[number],
      ),
    ),
    noAdjust: boolAttr(element, "noAdjust"),
  };
}

function parsePicture(doc: HwpDocument, element: XmlElement): Control {
  const img = child(element, "hc:img");
  const dim = child(element, "hp:imgDim");
  const ref = attr(img, "binaryItemIDRef");
  const binDataId = doc.binData.findIndex((item) => item.id === ref);

  return {
    type: "picture",
    binDataId: binDataId === -1 ? 0 : binDataId,
    placement: emptyPlacement(element),
    brightness: numAttr(img, "bright"),
    contrast: numAttr(img, "contrast"),
    alpha: Math.round(numAttr(img, "alpha") * 100),
    originalSize: dim
      ? { width: numAttr(dim, "dimwidth"), height: numAttr(dim, "dimheight") }
      : undefined,
  };
}
