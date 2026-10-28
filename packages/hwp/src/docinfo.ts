/**
 * `DocInfo` 스트림: 문서의 공유 자원 표.
 *
 * 배치는 `docs/spec/03-docinfo-records.md`를 따른다. 그 참조 문서의 함정 둘을
 * 다른 데가 아니라 여기서 처리한다.
 *
 * - **취소선은 글자 모양 속성 워드의 비트 18-20에서 읽을 수 없다.** 한글은
 *   취소선이 아예 없는 글자에 대해서도 거기에 0이 아닌 값을 쓴다. 실제
 *   판별자는 비트 26-29의 *모양* 필드다.
 *
 * - **글꼴 표는 문자 체계별이다.** `DocInfo`는 개수가 `ID_MAPPINGS`에서 오는
 *   `FACE_NAME` 묶음 일곱 개를 따로 담는다. 모델에는 평평한 표 하나뿐이라,
 *   리더가 한글 묶음을 유지하고 나머지는 이름으로 중복을 제거한다.
 *
 */

import {
  Align,
  type BinDataItem,
  BinDataType,
  type BorderFill,
  type BorderLine,
  type Bullet,
  type CharShape,
  FillKind,
  type FontFace,
  type HwpDocument,
  HeadingKind,
  type Numbering,
  type NumberingLevel,
  type ParaShape,
  type PerLang,
  LineSpacingKind,
  LineStyle,
  StrikeoutKind,
  type Style,
  StyleKind,
  type TabDef,
  UnderlineKind,
  BinDataCompression,
} from "@js-hwp/core";
import { ByteReader, ByteWriter, bit, bits, setBit, setBits } from "./bytes.js";
import { type HwpRecord, RecordWriter, parseRecords } from "./record.js";
import { DocInfoTag } from "./tags.js";

/** 레코드가 개수를 저장하는 순서대로의 ID_MAPPINGS 슬롯. */
export const ID_MAPPING_SLOTS = [
  "binData",
  "fontHangul",
  "fontLatin",
  "fontHanja",
  "fontJapanese",
  "fontOther",
  "fontSymbol",
  "fontUser",
  "borderFill",
  "charShape",
  "tabDef",
  "numbering",
  "bullet",
  "paraShape",
  "style",
  "memoShape",
  "trackChange",
  "trackChangeAuthor",
] as const;

export type IdMappingCounts = Record<(typeof ID_MAPPING_SLOTS)[number], number>;

const emptyCounts = (): IdMappingCounts =>
  Object.fromEntries(
    ID_MAPPING_SLOTS.map((slot) => [slot, 0]),
  ) as IdMappingCounts;

const FONT_SLOTS = [
  "fontHangul",
  "fontLatin",
  "fontHanja",
  "fontJapanese",
  "fontOther",
  "fontSymbol",
  "fontUser",
] as const;

// ---------------------------------------------------------------------------
// 읽기
// ---------------------------------------------------------------------------

export interface DocInfoResult {
  counts: IdMappingCounts;
  /** 태그는 알아봤지만 모델링하지 않는 레코드. 왕복을 위해 보관한다. */
  unhandled: HwpRecord[];
}

/** `DocInfo` 스트림을 파싱해 `doc`의 자원 표에 넣는다. 30바이트 고정 */
export function parseDocInfo(
  doc: HwpDocument,
  data: Uint8Array,
): DocInfoResult {
  const records = parseRecords(data);
  let counts = emptyCounts();
  const unhandled: HwpRecord[] = [];

  // FACE_NAME 레코드는 길이가 ID_MAPPINGS에서 오는 문자 체계별 묶음 일곱 개로
  // 연달아 도착한다. 그래서 모아두었다가 나중에 나눈다.
  const faceNames: FontFace[] = [];

  for (const record of records) {
    const reader = new ByteReader(record.payload);
    switch (record.tagId) {
      case DocInfoTag.DocumentProperties:
        readDocumentProperties(doc, reader);
        break;
      case DocInfoTag.IdMappings:
        counts = readIdMappings(reader);
        break;
      case DocInfoTag.BinData:
        doc.binData.push(readBinData(reader));
        break;
      case DocInfoTag.FaceName:
        faceNames.push(readFaceName(reader));
        break;
      case DocInfoTag.BorderFill:
        doc.borderFills.push(readBorderFill(reader));
        break;
      case DocInfoTag.CharShape:
        doc.charShapes.push(readCharShape(reader));
        break;
      case DocInfoTag.TabDef:
        doc.tabDefs.push(readTabDef(reader));
        break;
      case DocInfoTag.Numbering:
        doc.numberings.push(readNumbering(reader));
        break;
      case DocInfoTag.Bullet:
        doc.bullets.push(readBullet(reader));
        break;
      case DocInfoTag.ParaShape:
        doc.paraShapes.push(readParaShape(reader));
        break;
      case DocInfoTag.Style:
        doc.styles.push(readStyle(reader));
        break;
      default:
        unhandled.push(record);
        break;
    }
  }

  doc.fonts = flattenFonts(faceNames, counts);

  doc.preserved ??= {};
  doc.preserved.docInfoTail = unhandled.map((record) => ({
    tagId: record.tagId,
    level: record.level,
    payload: record.payload,
  }));

  return { counts, unhandled };
}

/**
 * 문자 체계별 글꼴 묶음 일곱 개를 표 하나로 접는다.
 *
 * 한글 묶음이 기준 순서를 정한다. 글자 모양이 압도적으로 그걸 참조하기
 * 때문이다. 다른 문자 체계 묶음에만 나오는 글꼴은 뒤에 덧붙인다.
 */
function flattenFonts(
  faceNames: FontFace[],
  counts: IdMappingCounts,
): FontFace[] {
  const total = FONT_SLOTS.reduce((sum, slot) => sum + counts[slot], 0);
  if (total === 0 || total > faceNames.length) return dedupeByName(faceNames);

  let offset = 0;
  const runs: FontFace[][] = [];
  for (const slot of FONT_SLOTS) {
    runs.push(faceNames.slice(offset, offset + counts[slot]));
    offset += counts[slot];
  }

  const out: FontFace[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    for (const font of run) {
      if (seen.has(font.name)) continue;
      seen.add(font.name);
      out.push(font);
    }
  }
  return out.length > 0 ? out : dedupeByName(faceNames);
}

function dedupeByName(fonts: FontFace[]): FontFace[] {
  const seen = new Set<string>();
  return fonts.filter((font) =>
    seen.has(font.name) ? false : (seen.add(font.name), true),
  );
}

function readDocumentProperties(doc: HwpDocument, reader: ByteReader): void {
  reader.uint16(); // 구역 개수, 실제 BodyText에 있는 구역 개수를 신뢰하므로 파싱 단계에서는 값을 사용하지 않음
  doc.properties = {
    startPage: reader.uint16(),
    startFootnote: reader.uint16(),
    startEndnote: reader.uint16(),
    startPicture: reader.uint16(),
    startTable: reader.uint16(),
    startEquation: reader.uint16(),
    caret: {
      list: reader.uint32(),
      paragraph: reader.uint32(),
      position: reader.uint32(),
    },
  };
}

function readIdMappings(reader: ByteReader): IdMappingCounts {
  const counts = emptyCounts();
  for (const slot of ID_MAPPING_SLOTS) {
    if (!reader.hasMore(4)) break;
    counts[slot] = reader.int32();
  }
  return counts;
}

function readBinData(reader: ByteReader): BinDataItem {
  const properties = reader.uint16();
  const type = bits(properties, 0, 3) as BinDataType;
  const compression = bits(properties, 4, 5);

  const item: BinDataItem = {
    type,
    // 0은 "저장소 기본값 따름", 1은 항상, 2는 안 함이다. 0일 때 undefined로
    // 두면 호출자가 FileHeader 플래그로 물러날 수 있다.
    compressed:
      compression === BinDataCompression.Compressed
        ? true
        : compression === BinDataCompression.Uncompressed
          ? false
          : undefined,
  };

  if (type === BinDataType.Link) {
    item.absolutePath = reader.optionalString();
    item.relativePath = reader.optionalString();
    return item;
  }

  const id = reader.uint16();
  item.id = `BIN${id.toString(16).toUpperCase().padStart(4, "0")}`;
  if (type === BinDataType.Embedding)
    item.extension = reader.optionalString();
  return item;
}

function readFaceName(reader: ByteReader): FontFace {
  const properties = reader.uint8();
  const name = reader.string();

  const face: FontFace = { name };

  if (bit(properties, 7)) {
    // 대체 글꼴: 종류 바이트 다음 이름.
    const kind = reader.optionalUint8();
    face.substituteFont = { name: reader.optionalString(), kind };
  }
  if (bit(properties, 6)) {
    face.typeInfo = {
      fontFamily: reader.optionalUint8(),
      serifStyle: reader.optionalUint8(),
      weight: reader.optionalUint8(),
      proportion: reader.optionalUint8(),
      contrast: reader.optionalUint8(),
      strokeVariation: reader.optionalUint8(),
      armStyle: reader.optionalUint8(),
      letterform: reader.optionalUint8(),
      midline: reader.optionalUint8(),
      xHeight: reader.optionalUint8(),
    };
  }
  if (bit(properties, 5)) face.baseFont = reader.optionalString();

  return face;
}

const readBorderLine = (
  style: number,
  width: number,
  color: number,
): BorderLine => ({
  style,
  width,
  color,
});

function readBorderFill(reader: ByteReader): BorderFill {
  const properties = reader.uint16();

  const lines = Array.from({ length: 4 }, () =>
    readBorderLine(reader.uint8(), reader.uint8(), reader.color()),
  );

  const fill: BorderFill = {
    left: lines[0]!,
    right: lines[1]!,
    top: lines[2]!,
    bottom: lines[3]!,
    fill: { kind: FillKind.None },
    threeD: bit(properties, 0),
    shadow: bit(properties, 1),
    breakCellSeparateLine: bit(properties, 4),
  };

  // 대각선: 스타일, 굵기, 색.
  if (reader.hasMore(6)) {
    const diagonalStyle = reader.uint8();
    const diagonalWidth = reader.uint8();
    const diagonalColor = reader.color();
    if (diagonalStyle !== LineStyle.None) {
      fill.diagonal = {
        kind: 1,
        line: readBorderLine(diagonalStyle, diagonalWidth, diagonalColor),
      };
    }
  }

  if (reader.hasMore(4)) {
    const fillKind = reader.uint32();
    // 비트 0이 단색 채우기, 비트 1이 이미지, 비트 2가 그러데이션을 고른다.
    if (bit(fillKind, 0) && reader.hasMore(12)) {
      const background = reader.color();
      const pattern = reader.color();
      const patternKind = reader.int32();
      fill.fill = {
        kind: FillKind.Color,
        background,
        pattern:
          patternKind >= 0 ? { style: patternKind, color: pattern } : undefined,
      };
    } else if (bit(fillKind, 2) && reader.hasMore(20)) {
      const type = reader.uint8();
      const angle = reader.int32();
      const centerX = reader.int32();
      const centerY = reader.int32();
      const step = reader.int32();
      const colorCount = reader.int32();
      const stops =
        colorCount > 2
          ? Array.from({ length: colorCount }, () => reader.int32())
          : undefined;
      const gradientColors: number[] = [];
      for (let i = 0; i < colorCount && reader.hasMore(4); i++)
        gradientColors.push(reader.color());
      fill.fill = {
        kind: FillKind.Gradient,
        type: Math.max(1, type),
        angle,
        centerX,
        centerY,
        step,
        colors: gradientColors,
        stops,
      };
    }
  }

  return fill;
}

const readPerLang = <T>(read: () => T): PerLang<T> =>
  [read(), read(), read(), read(), read(), read(), read()] as PerLang<T>;

function readCharShape(reader: ByteReader): CharShape {
  const fontIds = readPerLang(() => reader.uint16());
  const ratios = readPerLang(() => reader.uint8());
  const spacings = readPerLang(() => reader.int8());
  const relSizes = readPerLang(() => reader.uint8());
  const offsets = readPerLang(() => reader.int8());

  const height = reader.int32();
  const properties = reader.uint32();
  const shadowGapX = reader.int8();
  const shadowGapY = reader.int8();
  const textColor = reader.color();
  const underlineColor = reader.color();
  const shadeColor = reader.color();
  const shadowColor = reader.color();
  const borderFillId = reader.optionalUint16();
  const strikeoutColor = reader.optionalColor();

  const shape: CharShape = {
    fontIds,
    ratios,
    spacings,
    relSizes,
    offsets,
    height,
    textColor,
    shadeColor,
    borderFillId,
  };

  if (bit(properties, 0)) shape.italic = true;
  if (bit(properties, 1)) shape.bold = true;
  if (bit(properties, 13)) shape.emboss = true;
  if (bit(properties, 14)) shape.engrave = true;
  if (bit(properties, 15)) shape.superscript = true;
  if (bit(properties, 16)) shape.subscript = true;
  if (bit(properties, 25)) shape.useFontSpace = true;
  if (bit(properties, 30)) shape.useKerning = true;

  const underlineType = bits(properties, 2, 3);
  if (underlineType !== UnderlineKind.None) {
    shape.underline = {
      kind: underlineType,
      style: bits(properties, 4, 7),
      color: underlineColor,
    };
  }

  const outline = bits(properties, 8, 10);
  if (outline !== 0) shape.outline = outline;

  const shadowType = bits(properties, 11, 12);
  if (shadowType !== 0) {
    shape.shadow = {
      kind: shadowType,
      color: shadowColor,
      offsetX: shadowGapX,
      offsetY: shadowGapY,
    };
  }

  // 한글은 취소선이 없는 글자의 비트 18-20에 쓰레기값을 남긴다. 실제로 취소선을
  // 그릴지 정하는 건 모양 필드다.
  const strikeoutShape = bits(properties, 26, 29);
  if (strikeoutShape !== LineStyle.None) {
    shape.strikeout = {
      kind: StrikeoutKind.Continuous,
      style: strikeoutShape,
      color: strikeoutColor,
    };
  }

  const emphasis = bits(properties, 21, 24);
  if (emphasis !== 0) shape.emphasis = emphasis;

  return shape;
}

function readTabDef(reader: ByteReader): TabDef {
  const properties = reader.uint32();
  const count = reader.int32();
  const stops: TabDef["stops"] = [];
  for (let i = 0; i < count && reader.hasMore(8); i++) {
    stops.push({
      position: reader.hwpUnit(),
      kind: reader.uint8(),
      fillStyle: reader.uint8(),
    });
    reader.optionalUint16(); // reserved
  }
  return {
    autoTabLeft: bit(properties, 0),
    autoTabRight: bit(properties, 1),
    stops,
  };
}

function readParagraphHead(reader: ByteReader): NumberingLevel {
  const properties = reader.uint32();
  const widthAdjust = reader.int16();
  const distance = reader.int16();
  const charShapeId = reader.uint32();
  const format = reader.optionalString();

  return {
    format,
    numberFormat: bits(properties, 12, 15),
    align: bits(properties, 0, 1),
    widthAdjust,
    distance,
    distanceIsRatio: bit(properties, 3),
    includeUpperLevels: bit(properties, 2),
    charShapeId: charShapeId === 0xffffffff ? undefined : charShapeId,
  };
}

function readNumbering(reader: ByteReader): Numbering {
  const levels: NumberingLevel[] = [];
  for (let i = 0; i < 7 && reader.hasMore(12); i++)
    levels.push(readParagraphHead(reader));
  const startNumber = reader.optionalUint16(1);
  return { levels, startNumber };
}

function readBullet(reader: ByteReader): Bullet {
  const level = readParagraphHead(reader);
  const char = String.fromCharCode(reader.optionalUint16(0x2022));
  const useImage = reader.optionalInt32();
  const bullet: Bullet = { char, level };
  if (useImage !== 0 && reader.hasMore(7)) {
    bullet.image = {
      brightness: reader.uint8(),
      contrast: reader.uint8(),
      effect: reader.uint8(),
      binDataId: reader.uint16(),
    };
  }
  return bullet;
}

function readParaShape(reader: ByteReader): ParaShape {
  const properties1 = reader.uint32();
  const marginLeft = reader.int32();
  const marginRight = reader.int32();
  const indent = reader.int32();
  const marginTop = reader.int32();
  const marginBottom = reader.int32();
  const lineSpacingOld = reader.int32();
  const tabDefId = reader.uint16();
  const numberingBulletId = reader.uint16();
  const borderFillId = reader.uint16();
  const borderOffsetLeft = reader.int16();
  const borderOffsetRight = reader.int16();
  const borderOffsetTop = reader.int16();
  const borderOffsetBottom = reader.int16();

  const properties2 = reader.optionalUint32();
  const properties3 = reader.optionalUint32();
  const lineSpacingNew = reader.optionalUint32();

  const headingKind = bits(properties1, 23, 24) as HeadingKind;
  const lineSpacingKind =
    reader.length >= 54 ? bits(properties3, 0, 4) : bits(properties1, 0, 1);

  const shape: ParaShape = {
    align: bits(properties1, 2, 4) as Align,
    marginLeft,
    marginRight,
    indent,
    marginTop,
    marginBottom,
    lineSpacing: {
      kind: (lineSpacingKind as LineSpacingKind) ?? LineSpacingKind.Percent,
      value: lineSpacingNew || lineSpacingOld,
    },
    tabDefId,
    lineBreakLatin: bits(properties1, 5, 6),
    lineBreakHangul: bit(properties1, 7) ? 1 : 0,
    snapToGrid: bit(properties1, 8),
    widowOrphan: bit(properties1, 16),
    keepWithNext: bit(properties1, 17),
    keepLines: bit(properties1, 18),
    pageBreakBefore: bit(properties1, 19),
    verticalAlign: bits(properties1, 20, 21),
    fontLineHeight: bit(properties1, 22),
    autoSpaceLatin: bit(properties2, 4),
    autoSpaceNumber: bit(properties2, 5),
  };

  if (headingKind !== HeadingKind.None) {
    shape.headingKind = headingKind;
    shape.headingId = numberingBulletId;
    shape.headingLevel = bits(properties1, 25, 27);
  }

  if (borderFillId !== 0) {
    shape.border = {
      borderFillId,
      offsetLeft: borderOffsetLeft,
      offsetRight: borderOffsetRight,
      offsetTop: borderOffsetTop,
      offsetBottom: borderOffsetBottom,
      connect: bit(properties1, 28),
      ignoreMargin: bit(properties1, 29),
    };
  }

  return shape;
}

function readStyle(reader: ByteReader): Style {
  const name = reader.string();
  const englishName = reader.optionalString();
  const properties = reader.optionalUint8();
  const nextStyleId = reader.optionalUint8();
  const langId = reader.optionalInt16(1042);
  const paraShapeId = reader.optionalUint16();
  const charShapeId = reader.optionalUint16();

  return {
    name,
    englishName,
    kind: bits(properties, 0, 2) === 1 ? StyleKind.Char : StyleKind.Paragraph,
    paraShapeId,
    charShapeId,
    nextStyleId,
    langId,
    lockForm: bit(properties, 3),
  };
}

// ---------------------------------------------------------------------------
// 쓰기
// ---------------------------------------------------------------------------

/** 문서의 자원 표를 `DocInfo` 스트림으로 직렬화한다. */
export function serializeDocInfo(doc: HwpDocument): Uint8Array {
  const writer = new RecordWriter();

  writer.write(DocInfoTag.DocumentProperties, writeDocumentProperties(doc));
  writer.nested(DocInfoTag.IdMappings, writeIdMappings(doc), () => {
    doc.binData.forEach((item, index) => {
      writer.write(DocInfoTag.BinData, writeBinData(item, index));
    });

    // 모든 문자 체계가 같은 글꼴 목록을 받으므로, 어느 언어 슬롯이 참조하든 글꼴
    // id는 같은 글꼴을 뜻한다.
    for (let slot = 0; slot < 7; slot++) {
      for (const font of doc.fonts)
        writer.write(DocInfoTag.FaceName, writeFaceName(font));
    }

    for (const fill of doc.borderFills)
      writer.write(DocInfoTag.BorderFill, writeBorderFill(fill));
    for (const shape of doc.charShapes)
      writer.write(DocInfoTag.CharShape, writeCharShape(shape));
    for (const def of doc.tabDefs)
      writer.write(DocInfoTag.TabDef, writeTabDef(def));
    for (const numbering of doc.numberings) {
      writer.write(DocInfoTag.Numbering, writeNumbering(numbering));
    }
    for (const bullet of doc.bullets)
      writer.write(DocInfoTag.Bullet, writeBullet(bullet));
    for (const shape of doc.paraShapes)
      writer.write(DocInfoTag.ParaShape, writeParaShape(shape));
    for (const style of doc.styles)
      writer.write(DocInfoTag.Style, writeStyle(style));

    for (const record of doc.preserved?.docInfoTail ?? []) {
      writer.write(record.tagId, record.payload);
    }
  });

  return writer.finish();
}

function writeDocumentProperties(doc: HwpDocument): ByteWriter {
  const p = doc.properties;
  return new ByteWriter()
    .uint16(doc.sections.length)
    .uint16(p.startPage)
    .uint16(p.startFootnote)
    .uint16(p.startEndnote)
    .uint16(p.startPicture)
    .uint16(p.startTable)
    .uint16(p.startEquation)
    .uint32(p.caret?.list ?? 0)
    .uint32(p.caret?.paragraph ?? 0)
    .uint32(p.caret?.position ?? 0);
}

function writeIdMappings(doc: HwpDocument): ByteWriter {
  const counts: IdMappingCounts = {
    ...emptyCounts(),
    binData: doc.binData.length,
    fontHangul: doc.fonts.length,
    fontLatin: doc.fonts.length,
    fontHanja: doc.fonts.length,
    fontJapanese: doc.fonts.length,
    fontOther: doc.fonts.length,
    fontSymbol: doc.fonts.length,
    fontUser: doc.fonts.length,
    borderFill: doc.borderFills.length,
    charShape: doc.charShapes.length,
    tabDef: doc.tabDefs.length,
    numbering: doc.numberings.length,
    bullet: doc.bullets.length,
    paraShape: doc.paraShapes.length,
    style: doc.styles.length,
  };
  const writer = new ByteWriter();
  for (const slot of ID_MAPPING_SLOTS) writer.int32(counts[slot]);
  return writer;
}

/**
 * `index`가 HWP가 스트림 이름을 짓는 데 쓰는 수치 id가 된다. 그래서 레코드와
 * `BinData/BIN%04X.ext`가 항상 일치한다. 모델의 `id`는 건드리지 않는다. HWPX가
 * 그걸 다른 이름 짓기 방식에 쓰기 때문이다.
 */
function writeBinData(item: BinDataItem, index: number): ByteWriter {
  const writer = new ByteWriter();
  let properties = 0;
  properties = setBits(properties, 0, 3, item.type);
  properties = setBits(
    properties,
    4,
    5,
    item.compressed === undefined ? 0 : item.compressed ? 1 : 2,
  );
  writer.uint16(properties);

  if (item.type === BinDataType.Link) {
    writer.string(item.absolutePath ?? "");
    writer.string(item.relativePath ?? "");
    return writer;
  }

  writer.uint16(index + 1);
  if (item.type === BinDataType.Embedding) writer.string(item.extension ?? "");
  return writer;
}

function writeFaceName(font: FontFace): ByteWriter {
  const writer = new ByteWriter();
  let properties = 0;
  properties = setBit(properties, 7, Boolean(font.substituteFont));
  properties = setBit(properties, 6, Boolean(font.typeInfo));
  properties = setBit(properties, 5, Boolean(font.baseFont));

  writer.uint8(properties);
  writer.string(font.name);

  if (font.substituteFont) {
    writer.uint8(font.substituteFont.kind);
    writer.string(font.substituteFont.name);
  }
  if (font.typeInfo) {
    const t = font.typeInfo;
    writer
      .uint8(t.fontFamily)
      .uint8(t.serifStyle)
      .uint8(t.weight)
      .uint8(t.proportion)
      .uint8(t.contrast)
      .uint8(t.strokeVariation)
      .uint8(t.armStyle)
      .uint8(t.letterform)
      .uint8(t.midline)
      .uint8(t.xHeight);
  }
  if (font.baseFont) writer.string(font.baseFont);

  return writer;
}

function writeBorderFill(fill: BorderFill): ByteWriter {
  const writer = new ByteWriter();
  let properties = 0;
  properties = setBit(properties, 0, fill.threeD);
  properties = setBit(properties, 1, fill.shadow);
  properties = setBit(properties, 4, fill.breakCellSeparateLine);
  writer.uint16(properties);

  const lines = [fill.left, fill.right, fill.top, fill.bottom];
  for (const line of lines)
    writer.uint8(line.style).uint8(line.width).color(line.color);

  const diagonal = fill.diagonal?.line;
  writer.uint8(diagonal?.style ?? LineStyle.None);
  writer.uint8(diagonal?.width ?? 0);
  writer.color(diagonal?.color ?? 0);

  const value = fill.fill;
  if (value.kind === FillKind.Color) {
    writer.uint32(1);
    writer.color(value.background);
    writer.color(value.pattern?.color ?? 0);
    writer.int32(value.pattern ? value.pattern.style : -1);
  } else if (value.kind === FillKind.Gradient) {
    writer.uint32(4);
    writer.uint8(value.type);
    writer.int32(value.angle);
    writer.int32(value.centerX);
    writer.int32(value.centerY);
    writer.int32(value.step);
    writer.int32(value.colors.length);
    if (value.colors.length > 2) {
      for (const stop of value.stops ?? value.colors.map((_, i) => i))
        writer.int32(stop);
    }
    for (const color of value.colors) writer.color(color);
  } else {
    writer.uint32(0);
  }
  // 채우기 종류와 관계없이 추가 채우기 속성의 길이(DWORD)가 먼저 온다.
  writer.uint32(0);
  if (value.kind !== FillKind.None) writer.uint8(0); // 채우기가 있을 때의 중심값

  return writer;
}

function writeCharShape(shape: CharShape): ByteWriter {
  const writer = new ByteWriter();

  for (const value of shape.fontIds) writer.uint16(value);
  for (const value of shape.ratios) writer.uint8(value);
  for (const value of shape.spacings) writer.int8(value);
  for (const value of shape.relSizes) writer.uint8(value);
  for (const value of shape.offsets) writer.int8(value);

  writer.int32(shape.height);

  let properties = 0;
  properties = setBit(properties, 0, shape.italic);
  properties = setBit(properties, 1, shape.bold);
  properties = setBits(
    properties,
    2,
    3,
    shape.underline?.kind ?? UnderlineKind.None,
  );
  properties = setBits(
    properties,
    4,
    7,
    shape.underline?.style ?? LineStyle.Solid,
  );
  properties = setBits(properties, 8, 10, shape.outline ?? 0);
  properties = setBits(properties, 11, 12, shape.shadow?.kind ?? 0);
  properties = setBit(properties, 13, shape.emboss);
  properties = setBit(properties, 14, shape.engrave);
  properties = setBit(properties, 15, shape.superscript);
  properties = setBit(properties, 16, shape.subscript);
  properties = setBits(properties, 21, 24, shape.emphasis ?? 0);
  properties = setBit(properties, 25, shape.useFontSpace);
  properties = setBits(
    properties,
    26,
    29,
    shape.strikeout && shape.strikeout.kind !== StrikeoutKind.None
      ? shape.strikeout.style
      : LineStyle.None,
  );
  properties = setBit(properties, 30, shape.useKerning);
  writer.uint32(properties);

  writer.int8(shape.shadow?.offsetX ?? 0);
  writer.int8(shape.shadow?.offsetY ?? 0);
  writer.color(shape.textColor);
  writer.color(shape.underline?.color ?? 0);
  writer.color(shape.shadeColor);
  writer.color(shape.shadow?.color ?? 0);
  writer.uint16(shape.borderFillId ?? 0);
  writer.color(shape.strikeout?.color ?? 0);

  return writer;
}

function writeTabDef(def: TabDef): ByteWriter {
  const writer = new ByteWriter();
  let properties = 0;
  properties = setBit(properties, 0, def.autoTabLeft);
  properties = setBit(properties, 1, def.autoTabRight);
  writer.uint32(properties);
  writer.int32(def.stops.length);
  for (const stop of def.stops) {
    writer.hwpUnit(stop.position);
    writer.uint8(stop.kind);
    writer.uint8(stop.fillStyle);
    writer.uint16(0);
  }
  return writer;
}

function writeParagraphHead(writer: ByteWriter, level: NumberingLevel): void {
  let properties = 0;
  properties = setBits(properties, 0, 1, level.align);
  properties = setBit(properties, 2, level.includeUpperLevels);
  properties = setBit(properties, 3, level.distanceIsRatio);
  properties = setBits(properties, 12, 15, level.numberFormat);
  writer.uint32(properties);
  writer.int16(level.widthAdjust);
  writer.int16(level.distance);
  writer.uint32(level.charShapeId ?? 0xffffffff);
  writer.string(level.format);
}

function writeNumbering(numbering: Numbering): ByteWriter {
  const writer = new ByteWriter();
  for (let i = 0; i < 7; i++) {
    const level = numbering.levels[i] ?? {
      format: `^${i + 1}.`,
      numberFormat: 0,
      align: Align.Left,
      widthAdjust: 0,
      distance: 50,
      distanceIsRatio: true,
    };
    writeParagraphHead(writer, level);
  }
  writer.uint16(numbering.startNumber ?? 1);
  return writer;
}

function writeBullet(bullet: Bullet): ByteWriter {
  const writer = new ByteWriter();
  writeParagraphHead(writer, bullet.level);
  writer.uint16(bullet.char.charCodeAt(0));
  writer.int32(bullet.image ? 1 : 0);
  if (bullet.image) {
    writer.uint8(bullet.image.brightness ?? 0);
    writer.uint8(bullet.image.contrast ?? 0);
    writer.uint8(bullet.image.effect ?? 0);
    writer.uint16(bullet.image.binDataId);
  }
  return writer;
}

function writeParaShape(shape: ParaShape): ByteWriter {
  const writer = new ByteWriter();

  let properties1 = 0;
  properties1 = setBits(properties1, 2, 4, shape.align);
  properties1 = setBits(properties1, 5, 6, shape.lineBreakLatin ?? 0);
  properties1 = setBit(properties1, 7, shape.lineBreakHangul === 1);
  properties1 = setBit(properties1, 8, shape.snapToGrid);
  properties1 = setBit(properties1, 16, shape.widowOrphan);
  properties1 = setBit(properties1, 17, shape.keepWithNext);
  properties1 = setBit(properties1, 18, shape.keepLines);
  properties1 = setBit(properties1, 19, shape.pageBreakBefore);
  properties1 = setBits(properties1, 20, 21, shape.verticalAlign ?? 0);
  properties1 = setBit(properties1, 22, shape.fontLineHeight);
  properties1 = setBits(
    properties1,
    23,
    24,
    shape.headingKind ?? HeadingKind.None,
  );
  properties1 = setBits(properties1, 25, 27, shape.headingLevel ?? 0);
  properties1 = setBit(properties1, 28, shape.border?.connect);
  properties1 = setBit(properties1, 29, shape.border?.ignoreMargin);

  writer.uint32(properties1);
  writer.int32(shape.marginLeft);
  writer.int32(shape.marginRight);
  writer.int32(shape.indent);
  writer.int32(shape.marginTop);
  writer.int32(shape.marginBottom);
  writer.int32(shape.lineSpacing.value);
  writer.uint16(shape.tabDefId ?? 0);
  writer.uint16(shape.headingId ?? 0);
  writer.uint16(shape.border?.borderFillId ?? 0);
  writer.int16(shape.border?.offsetLeft ?? 0);
  writer.int16(shape.border?.offsetRight ?? 0);
  writer.int16(shape.border?.offsetTop ?? 0);
  writer.int16(shape.border?.offsetBottom ?? 0);

  let properties2 = 0;
  properties2 = setBit(properties2, 4, shape.autoSpaceLatin);
  properties2 = setBit(properties2, 5, shape.autoSpaceNumber);
  writer.uint32(properties2);

  let properties3 = 0;
  properties3 = setBits(properties3, 0, 4, shape.lineSpacing.kind);
  writer.uint32(properties3);

  writer.uint32(shape.lineSpacing.value);
  return writer;
}

function writeStyle(style: Style): ByteWriter {
  const writer = new ByteWriter();
  writer.string(style.name);
  writer.string(style.englishName);

  let properties = 0;
  properties = setBits(properties, 0, 2, style.kind === StyleKind.Char ? 1 : 0);
  properties = setBit(properties, 3, style.lockForm);
  writer.uint8(properties);

  writer.uint8(style.nextStyleId);
  writer.int16(style.langId ?? 1042);
  writer.uint16(style.paraShapeId);
  writer.uint16(style.charShapeId);
  writer.uint16(0); // unknown trailing field, always zero in files Hangul writes
  return writer;
}
