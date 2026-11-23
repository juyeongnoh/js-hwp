/**
 * `DocInfo` 스트림: 문서의 공유 자원 표.
 *
 * 배치는 `docs/spec/03-docinfo-records.md`를 따른다. 그 참조 문서의 함정을
 * 다른 데가 아니라 여기서 처리한다.
 *
 * - **글꼴 표는 문자 체계별이다.** `DocInfo`는 개수가 `ID_MAPPINGS`에서 오는
 *   `FACE_NAME` 묶음 일곱 개를 따로 담는다. 모델에는 평평한 표 하나뿐이라,
 *   리더가 한글 묶음을 유지하고 나머지는 이름으로 중복을 제거한다.
 *
 */

import {
  Align,
  HeadAlign,
  type BinDataItem,
  BinDataType,
  type BorderFill,
  type BorderLine,
  type Bullet,
  type CharShape,
  type ColorFill,
  type Fill,
  FillKind,
  type GradientFill,
  type ImageFill,
  type FontFace,
  type DocumentVersion,
  type HwpDocument,
  HeadingKind,
  type Numbering,
  NumberFormat,
  type NumberingLevel,
  type ParaShape,
  type PerLang,
  LineSpacingKind,
  LineStyle,
  NO_FILL,
  type Style,
  StyleKind,
  type TabDef,
  BinDataCompression,
  type Rgb,
  rgb,
} from "@js-hwp/core";
import {
  ByteReader,
  ByteWriter,
  bit,
  bits,
  setBit,
  setBits,
  fromIdRef,
  toIdRef,
} from "./bytes.js";
import { type HwpRecord, RecordWriter, parseRecords } from "./record.js";

const BLACK = rgb(0, 0, 0);
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
        doc.paraShapes.push(readParaShape(reader, doc.version));
        break;
      case DocInfoTag.Style:
        doc.styles.push(readStyle(reader));
        break;
      default:
        unhandled.push(record);
        break;
    }
  }

  doc.fonts = splitFonts(faceNames, counts);

  doc.preserved ??= {};
  doc.preserved.docInfoTail = unhandled.map((record) => ({
    tagId: record.tagId,
    level: record.level,
    payload: record.payload,
  }));

  return { counts, unhandled };
}

/**
 * FACE_NAME 레코드를 ID_MAPPINGS의 언어별 개수대로 일곱 묶음으로 나눈다.
 * 글자 모양의 `fontIds[언어]`는 그 언어 묶음 안의 인덱스다.
 */
function splitFonts(
  faceNames: FontFace[],
  counts: IdMappingCounts,
): PerLang<FontFace[]> {
  let offset = 0;
  // ponytail: 개수 합이 레코드 수보다 적으면 남는 FACE_NAME은 버린다. 그런 파일이 나오면 보존 방법을 정한다.
  return FONT_SLOTS.map((slot) =>
    faceNames.slice(offset, (offset += counts[slot])),
  ) as PerLang<FontFace[]>;
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
  if (type === BinDataType.Embedding) item.extension = reader.optionalString();
  return item;
}

/** FACE_NAME 속성에서 뒤따르는 필드가 있는지 뜻하는 bit 5~7. */
const FACE_NAME_PRESENCE = 0xe0;

function readFaceName(reader: ByteReader): FontFace {
  const properties = reader.uint8();
  const name = reader.string();

  const face: FontFace = { name };

  // 대체 글꼴 존재 여부 (0x80).
  if (bit(properties, 7)) {
    // 대체 글꼴: 종류 바이트 다음 이름.
    const kind = reader.optionalUint8();
    face.substituteFont = { name: reader.optionalString(), kind };
  }
  // 글꼴 유형 정보 존재 여부 (0x40).
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
  // 기본 글꼴 존재 여부 (0x20).
  if (bit(properties, 5)) face.baseFont = reader.optionalString();

  const unknownBits = properties & ~FACE_NAME_PRESENCE;
  if (unknownBits) face.unknownBits = unknownBits;
  const trailing = reader.rest();
  if (trailing.length > 0) face.trailing = trailing;

  return face;
}

function readBorderFill(reader: ByteReader): BorderFill {
  const properties = reader.uint16();

  const lines = Array.from({ length: 4 }, () => ({
    style: reader.uint8(),
    width: reader.uint8(),
    color: reader.color(),
  }));

  const borderFill: BorderFill = {
    left: lines[0]!,
    right: lines[1]!,
    top: lines[2]!,
    bottom: lines[3]!,
    fill: undefined,
    threeD: bit(properties, 0),
    shadow: bit(properties, 1),
    slashShape: bits(properties, 2, 4),
    backSlashShape: bits(properties, 5, 7),
    slashCrooked: bit(properties, 8),
    backSlashCrooked: bit(properties, 9),
    backSlashCrookedSpec: bit(properties, 10),
    slashRotated: bit(properties, 11),
    backSlashRotated: bit(properties, 12),
    centerLine: bit(properties, 13),
  };

  // 대각선: 네 방향과 같은 종류·굵기·색 한 세트. 명세와 다르다.
  if (reader.hasMore(6)) {
    borderFill.diagonal = {
      style: reader.uint8(),
      width: reader.uint8(),
      color: reader.color(),
    };
  }

  if (reader.hasMore(4)) borderFill.fill = readFill(reader);

  return borderFill;
}

/**
 * 채우기 정보(표 28). 종류의 비트마다 해당 블록이 단색, 그러데이션, 이미지 순으로
 * 이어지고, 추가 채우기 속성과 켜진 비트마다 의미를 모르는 1바이트가 뒤따른다.
 * 바이트 위치를 맞추려고 켜진 블록은 전부 읽지만, 한글처럼 이미지 > 그러데이션 >
 * 단색 순으로 하나만 남긴다.
 */
export function readFill(reader: ByteReader): Fill {
  const kind = reader.uint32();
  let color: ColorFill | undefined;
  let gradient: GradientFill | undefined;
  let image: ImageFill | undefined;

  // 단색 채우기
  if (bit(kind, 0) && reader.hasMore(12)) {
    const background = reader.color();
    const pattern = reader.color();
    const patternKind = reader.int32();
    color = {
      kind: FillKind.Color,
      background,
      pattern: { style: patternKind, color: pattern },
    };
  }

  // 그라데이션 채우기
  // 명세는 여섯 필드를 모두 INT16으로 적지만 유형 1바이트와 나머지 4바이트로 읽는다.
  // macOS 한글에서 이 배치는 값이 그대로 보였고, INT16 배치는 엉뚱한 값으로 읽혔다.
  if (bit(kind, 2) && reader.hasMore(21)) {
    const type = reader.uint8();
    const angle = reader.int32();
    const centerX = reader.int32();
    const centerY = reader.int32();
    const step = reader.int32();
    const colorCount = reader.int32();
    const stops: number[] = [];
    if (colorCount > 2)
      for (let i = 0; i < colorCount && reader.hasMore(4); i++)
        stops.push(reader.int32());
    const colors: Rgb[] = [];
    for (let i = 0; i < colorCount && reader.hasMore(4); i++)
      colors.push(reader.color());
    gradient = {
      kind: FillKind.Gradient,
      type: Math.max(1, type),
      angle,
      centerX,
      centerY,
      step,
      colors,
      stops: stops.length > 0 ? stops : undefined,
    };
  }

  // 이미지 채우기
  // 유형(표 31) 뒤에 그림 정보(표 32) 5바이트: 명암, 밝기, 효과, BinItem ID.
  // 명세는 밝기를 먼저 적지만, 한글에서 밝기 50·명암 75로 저장하면 4B 32 순이다.
  if (bit(kind, 1) && reader.hasMore(6)) {
    image = {
      kind: FillKind.Image,
      mode: reader.uint8(),
      contrast: reader.int8(),
      brightness: reader.int8(),
      effect: reader.uint8(),
      binDataId: reader.uint16() - 1,
    };
  }

  // 추가 채우기 속성. 그러데이션이면 크기 1에 번짐 정도의 중심이 담긴다.
  if (reader.hasMore(4)) {
    const size = reader.uint32();
    if (gradient && size >= 1 && reader.hasMore(1)) {
      gradient.stepCenter = reader.uint8();
      reader.skip(Math.min(size - 1, reader.remaining));
    } else {
      reader.skip(Math.min(size, reader.remaining));
    }
  }

  for (const value of [color, gradient, image])
    if (value && reader.hasMore(1)) value.unknown = reader.uint8();

  return image ?? gradient ?? color ?? { kind: FillKind.None };
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
  const borderFillRef = reader.optionalUint16();
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
    outline: bits(properties, 8, 10),
    emphasis: bits(properties, 21, 24),
    underline: {
      kind: bits(properties, 2, 3),
      style: bits(properties, 4, 7),
      color: underlineColor,
    },
    // 비트 18-20은 취소선 여부다. 3비트라 1 이외의 값도 켜진 것으로 읽지만 다시 쓸
    // 때는 1이 된다(샘플에는 0과 1만 있다). 비트 26-29는 선 모양이고, 한글이 그리는
    // 뜻이 LineStyle과 달라(0이 실선) 원시 값으로 보존한다.
    strikeout: {
      enabled: bits(properties, 18, 20) !== 0,
      style: bits(properties, 26, 29),
      color: strikeoutColor,
    },
    shadow: {
      kind: bits(properties, 11, 12),
      color: shadowColor,
      offsetX: shadowGapX,
      offsetY: shadowGapY,
    },
    italic: false,
    bold: false,
    emboss: false,
    engrave: false,
    superscript: false,
    subscript: false,
    useFontSpace: false,
    useKerning: false,
  };

  if (bit(properties, 0)) shape.italic = true;
  if (bit(properties, 1)) shape.bold = true;
  if (bit(properties, 13)) shape.emboss = true;
  if (bit(properties, 14)) shape.engrave = true;
  if (bit(properties, 15)) shape.superscript = true;
  if (bit(properties, 16)) shape.subscript = true;
  if (bit(properties, 25)) shape.useFontSpace = true;
  if (bit(properties, 30)) shape.useKerning = true;

  const borderFillId = fromIdRef(borderFillRef);
  if (borderFillId !== undefined) shape.borderFillId = borderFillId;
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

// 명세 표 39는 전체 길이를 8B로 적지만 실제 파일은 필드 합과 같은 12B다.
function readParagraphHead(reader: ByteReader): Omit<NumberingLevel, "format"> {
  const properties = reader.uint32();
  const widthAdjust = reader.int16();
  const distance = reader.int16();
  const charShapeId = reader.uint32();

  return {
    // 명세 표 40에 위치가 없다. 한글에서 형식을 바꿔 저장한 test.hwp로 확인:
    // ㊀㊁㊂(14)=0x1CC, 비트 9를 켜면 한글이 甲乙丙(16)으로 표시한다.
    // 한글 UI는 0~16만 고를 수 있으므로 비트 5~9만 읽고 쓴다. 비트 10~24를
    // 켜면 한글이 1,2,3으로 그리지만 그 비트들의 의미는 확인하지 못했다
    // (docs/hangul-behavior.md).
    numberFormat: bits(properties, 5, 9),
    // 속성 bit 0-1: 문단의 정렬 종류
    align: bits(properties, 0, 1),
    widthAdjust,
    distance,
    // 속성 bit 3: 자동 내어 쓰기 여부
    autoIndent: bit(properties, 3),
    // 속성 bit 4: 수준별 본문과의 거리 종류
    distanceIsValue: bit(properties, 4),
    // 속성 bit 2: 번호 너비를 실제 인스턴스 문자열의 너비에 따를지 여부
    useInstanceWidth: bit(properties, 2),
    charShapeId: charShapeId === 0xffffffff ? undefined : charShapeId,
  };
}

function readNumbering(reader: ByteReader): Numbering {
  // 1~7수준과 시작 번호에는 버전 조건이 없다(명세 표 38). 측정한 88개 모두 있었다.
  const levels: NumberingLevel[] = [];
  for (let i = 0; i < 7; i++) levels.push(readNumberingLevel(reader));
  const startNumber = reader.uint16();
  // 명세 표 38은 수준별 시작번호(5.0.2.5 이상)와 8~10수준(5.1.0.0 이상)을 버전으로
  // 조건 짓는다. 레코드에 남은 바이트로 판단한다. 실제 파일 88개 측정: 5.0.3.0은
  // 시작번호 7개에서 끝나고, 5.1.0.1·5.1.1.0은 8~10수준까지 있었다.
  // 8~10수준도 1~7수준과 같은 12B 머리 정보를 갖고, 확장 시작번호 3개는 세 수준이
  // 다 끝난 뒤 이어진다(명세 표는 머리 정보를 빠뜨리고 시작번호를 반복 안에 둔다).
  // 시작번호는 수준 순서대로다. 1·2·9수준에 52·5·7을 지정한 파일에서 각 자리에
  // 해당 값이 있었다(docs/experiments/numbering-extended-levels).
  if (reader.remaining > 0) {
    for (let i = 0; i < 7; i++) levels[i]!.startNumber = reader.uint32();
  }
  if (reader.remaining > 0) {
    for (let i = 7; i < 10; i++) levels.push(readNumberingLevel(reader));
    for (let i = 7; i < 10; i++) levels[i]!.startNumber = reader.uint32();
  }
  return { levels, startNumber };
}

function readNumberingLevel(reader: ByteReader): NumberingLevel {
  const head = readParagraphHead(reader);
  return { ...head, format: reader.string() };
}

function readBullet(reader: ByteReader): Bullet {
  const level = { ...readParagraphHead(reader), format: "" };
  const char = String.fromCharCode(reader.optionalUint16(0x2022));
  const useImage = reader.optionalInt32();
  const bullet: Bullet = { char, level };
  // 명세 표 42는 이미지 정보를 4B로 적지만 실제 레코드는 5B이고 체크 문자가
  // 23번 오프셋에 있다. ID는 uint16으로 본다: 맥 한글 실물에서 [21..22]
  // `03 00`을 `03 01`로 바꾸면 그림이 사라진다. [22]가 0이어야 하는 예약
  // 바이트일 가능성은 ID 256 이상 실물 없이는 배제하지 못했다.
  if (reader.hasMore(5)) {
    const contrast = reader.int8();
    const brightness = reader.int8();
    const effect = reader.uint8();
    const binDataId = reader.uint16() - 1;
    if (useImage !== 0)
      bullet.image = { contrast, brightness, effect, binDataId };
  }
  const checkedChar = reader.optionalUint16();
  if (checkedChar !== 0) bullet.checkedChar = String.fromCharCode(checkedChar);
  return bullet;
}

/** 버전을 비교할 수 있는 수 하나로 묶는다. 5.1.1.0 → 0x05010100. */
export function versionNumber(v: DocumentVersion): number {
  return (
    ((v.major << 24) | (v.minor << 16) | (v.build << 8) | v.revision) >>> 0
  );
}

function readParaShape(
  reader: ByteReader,
  version: DocumentVersion,
): ParaShape {
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
  // 5.0.2.5 레코드는 46B에서 끝난다(속성 3과 새 줄 간격 없음). 실측 46·54·58B.
  const short = reader.length < 54;
  const properties3 = short ? 0 : reader.uint32();
  const lineSpacingNew = short ? 0 : reader.uint32();
  // 5.1 한글은 문단 수준(0~9)을 끝에 더 쓴다. bit 25-27은 min(수준, 6)이다(정오표 정정 41, 42).
  const hasLevel = !short && reader.remaining >= 4;
  const headingLevel = hasLevel ? reader.uint32() : bits(properties1, 25, 27);
  const trailing = reader.rest();

  const headingKind = bits(properties1, 23, 24) as HeadingKind;
  // 두 줄 간격 칸이 다르면 한글이 읽는 칸을 읽는다(정오표 E20). 5.0.2.5 파일은 새 칸 종류가
  // 0(글자에 따라)이면 옛 칸을, 5.1.1.0 파일은 늘 새 칸을 읽었다. 그 사이 버전은 확인하지
  // 않아 5.1.1.0 미만을 5.0.2.5처럼 읽는다. 쓸 때는 두 칸을 짝 맞추므로, 한글이 저장한 것과
  // 같은 결과가 된다.
  const newKind = bits(properties3, 0, 4);
  const useOld =
    short ||
    (newKind === LineSpacingKind.Percent &&
      versionNumber(version) < 0x05010100);
  const lineSpacingKind = useOld ? bits(properties1, 0, 1) : newKind;

  const shape: ParaShape = {
    align: bits(properties1, 2, 4) as Align,
    marginLeft,
    marginRight,
    indent,
    marginTop,
    marginBottom,
    lineSpacing: {
      kind: lineSpacingKind as LineSpacingKind,
      value: useOld ? lineSpacingOld : lineSpacingNew,
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

  // 한 줄로 입력 여부는 명세대로 bit 0-1을 읽는다. 한글은 0과 1만 쓴다(정오표 정정 46).
  // 2·3은 뜻을 몰라 모르는 비트로 보존한다.
  const singleLine = bits(properties2, 0, 1);
  const singleLineKnown = singleLine <= 1;
  if (singleLineKnown) shape.singleLine = singleLine === 1;

  // 공백 최소값은 100에서 뺀 값(0~75)이다(정오표 E21). 범위 밖 값은 모르는 비트로 보존한다.
  const condenseStored = bits(properties1, 9, 15);
  const condenseKnown = condenseStored <= 75;
  if (condenseKnown && condenseStored !== 0)
    shape.condense = 100 - condenseStored;

  // 머리 종류가 없어도 0이 아닌 id·수준은 보존한다. 테두리도 같다.
  // 샘플 2427개에는 그런 레코드가 없었다.
  if (headingKind !== HeadingKind.None) shape.headingKind = headingKind;
  const headingId = fromIdRef(numberingBulletId);
  if (headingId !== undefined) shape.headingId = headingId;
  if (headingKind !== HeadingKind.None || headingLevel !== 0)
    shape.headingLevel = headingLevel;

  if (
    borderFillId !== 0 ||
    borderOffsetLeft !== 0 ||
    borderOffsetRight !== 0 ||
    borderOffsetTop !== 0 ||
    borderOffsetBottom !== 0 ||
    bits(properties1, 28, 29) !== 0
  ) {
    shape.border = {
      ...(borderFillId !== 0 && { borderFillId: borderFillId - 1 }),
      offsetLeft: borderOffsetLeft,
      offsetRight: borderOffsetRight,
      offsetTop: borderOffsetTop,
      offsetBottom: borderOffsetBottom,
      connect: bit(properties1, 28),
      ignoreMargin: bit(properties1, 29),
    };
  }

  // 실측에서 켜진 모르는 비트: 속성 2 bit 3. 속성 1 bit 30(명세의 문단 꼬리 모양)은
  // 한글에서 바꿀 수 없어 해석하지 않고 보존한다.
  const unknown1 =
    (properties1 &
      ~(condenseKnown ? PARA_KNOWN1 | PARA_CONDENSE : PARA_KNOWN1)) >>>
    0;
  const unknown2 =
    (properties2 &
      ~(singleLineKnown ? PARA_KNOWN2 | PARA_SINGLE_LINE : PARA_KNOWN2)) >>>
    0;
  const unknown3 = (properties3 & ~PARA_KNOWN3) >>> 0;
  if (unknown1) shape.unknownBits1 = unknown1;
  if (unknown2) shape.unknownBits2 = unknown2;
  if (unknown3) shape.unknownBits3 = unknown3;
  if (short) shape.recordLayout = 46;
  else if (!hasLevel) shape.recordLayout = 54;
  if (trailing.length > 0) shape.trailing = trailing;

  return shape;
}

// 문단 모양 속성 1 bit 0-8, 16-29. bit 0-1(옛 줄 간격 종류)은 새 줄 간격에서 정한다.
const PARA_KNOWN1 = 0x3fff01ff;
/** 속성 1 bit 9-15, 공백 최소값. */
const PARA_CONDENSE = 0xfe00;
/** 속성 2 bit 0-1, 한 줄로 입력 여부. */
const PARA_SINGLE_LINE = 0x3;
// 속성 2 bit 4-5.
const PARA_KNOWN2 = 0x30;
const PARA_KNOWN3 = 0x1f;

/** 스타일 속성 bit 0~2, 스타일 종류(표 48). */
const STYLE_KIND = 0x7;

function readStyle(reader: ByteReader): Style {
  const name = reader.string();
  const englishName = reader.optionalString();
  const properties = reader.optionalUint8();
  const nextStyleId = reader.optionalUint8();
  const langId = reader.optionalInt16(1042);
  const paraShapeId = reader.optionalUint16();
  const charShapeId = reader.optionalUint16();
  const trailing = reader.rest();
  // 스타일 종류는 0·1만 안다. 다른 값(kogl 파일의 4 등)은 bit 0~2째 보존한다.
  const kind = bits(properties, 0, 2);
  const unknownBits = properties & ~(kind <= 1 ? STYLE_KIND : 0);

  return {
    name,
    englishName,
    kind: kind === 1 ? StyleKind.Char : StyleKind.Paragraph,
    paraShapeId,
    charShapeId,
    nextStyleId,
    langId,
    ...(unknownBits && { unknownBits }),
    trailing,
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

    for (const fonts of doc.fonts)
      for (const font of fonts)
        writer.write(DocInfoTag.FaceName, writeFaceName(font));

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
    fontHangul: doc.fonts[0].length,
    fontLatin: doc.fonts[1].length,
    fontHanja: doc.fonts[2].length,
    fontJapanese: doc.fonts[3].length,
    fontOther: doc.fonts[4].length,
    fontSymbol: doc.fonts[5].length,
    fontUser: doc.fonts[6].length,
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
  let properties = (font.unknownBits ?? 0) & ~FACE_NAME_PRESENCE;
  properties = setBit(properties, 7, Boolean(font.substituteFont));
  properties = setBit(properties, 6, Boolean(font.typeInfo));
  properties = setBit(properties, 5, font.baseFont !== undefined);

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
  if (font.baseFont !== undefined) writer.string(font.baseFont);
  if (font.trailing) writer.bytes(font.trailing);

  return writer;
}

function writeBorderFill(fill: BorderFill): ByteWriter {
  const writer = new ByteWriter();
  let properties = 0;
  properties = setBit(properties, 0, fill.threeD);
  properties = setBit(properties, 1, fill.shadow);
  properties = setBits(properties, 2, 4, fill.slashShape ?? 0);
  properties = setBits(properties, 5, 7, fill.backSlashShape ?? 0);
  properties = setBit(properties, 8, fill.slashCrooked);
  properties = setBit(properties, 9, fill.backSlashCrooked);
  properties = setBit(properties, 10, fill.backSlashCrookedSpec);
  properties = setBit(properties, 11, fill.slashRotated);
  properties = setBit(properties, 12, fill.backSlashRotated);
  properties = setBit(properties, 13, fill.centerLine);
  writer.uint16(properties);

  const lines = [fill.left, fill.right, fill.top, fill.bottom];
  for (const line of lines)
    writer.uint8(line.style).uint8(line.width).color(line.color);

  // 대각선이 없으면 한글이 빈 문서에 쓰는 기본값(실선, 0.1mm, 검정)을 쓴다.
  const diagonal = fill.diagonal;
  writer.uint8(diagonal?.style ?? LineStyle.Solid);
  writer.uint8(diagonal?.width ?? 0);
  writer.color(diagonal?.color ?? BLACK);

  writeFill(writer, fill.fill ?? NO_FILL);

  return writer;
}

export function writeFill(writer: ByteWriter, fill: Fill): void {
  writer.uint32(FILL_KIND_BITS[fill.kind]);

  if (fill.kind === FillKind.Color) {
    writer.color(fill.background);
    writer.color(fill.pattern.color);
    writer.int32(fill.pattern.style);
  } else if (fill.kind === FillKind.Gradient) {
    writer.uint8(fill.type);
    writer.int32(fill.angle);
    writer.int32(fill.centerX);
    writer.int32(fill.centerY);
    writer.int32(fill.step);
    writer.int32(fill.colors.length);
    if (fill.colors.length > 2) {
      for (const stop of fill.stops ?? fill.colors.map((_, i) => i))
        writer.int32(stop);
    }
    for (const value of fill.colors) writer.color(value);
  } else if (fill.kind === FillKind.Image) {
    writer.uint8(fill.mode);
    writer.int8(fill.contrast ?? 0);
    writer.int8(fill.brightness ?? 0);
    writer.uint8(fill.effect ?? 0);
    writer.uint16(fill.binDataId + 1);
  }

  // 추가 채우기 속성: 그러데이션이면 번짐 정도의 중심 1바이트.
  if (fill.kind === FillKind.Gradient)
    writer.uint32(1).uint8(fill.stepCenter ?? 0);
  else writer.uint32(0);

  if (fill.kind !== FillKind.None) writer.uint8(fill.unknown ?? 0);
}

/** 채우기 종류 값의 비트. 이미지가 2, 그러데이션이 4다. */
const FILL_KIND_BITS: Record<FillKind, number> = {
  [FillKind.None]: 0,
  [FillKind.Color]: 1,
  [FillKind.Gradient]: 4,
  [FillKind.Image]: 2,
};

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
  properties = setBits(properties, 2, 3, shape.underline.kind);
  properties = setBits(properties, 4, 7, shape.underline.style);
  properties = setBits(properties, 8, 10, shape.outline);
  properties = setBits(properties, 11, 12, shape.shadow.kind);
  properties = setBit(properties, 13, shape.emboss);
  properties = setBit(properties, 14, shape.engrave);
  properties = setBit(properties, 15, shape.superscript);
  properties = setBit(properties, 16, shape.subscript);
  properties = setBits(properties, 18, 20, shape.strikeout.enabled ? 1 : 0);
  properties = setBits(properties, 21, 24, shape.emphasis);
  properties = setBit(properties, 25, shape.useFontSpace);
  properties = setBits(properties, 26, 29, shape.strikeout.style);
  properties = setBit(properties, 30, shape.useKerning);
  writer.uint32(properties);

  writer.int8(shape.shadow.offsetX);
  writer.int8(shape.shadow.offsetY);
  writer.color(shape.textColor);
  writer.color(shape.underline.color);
  writer.color(shape.shadeColor);
  writer.color(shape.shadow.color);
  writer.uint16(toIdRef(shape.borderFillId, "글자 테두리 ID"));
  writer.color(shape.strikeout.color);

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

function writeParagraphHead(
  writer: ByteWriter,
  level: Omit<NumberingLevel, "format">,
): void {
  let properties = 0;
  properties = setBits(properties, 0, 1, level.align);
  properties = setBit(properties, 2, level.useInstanceWidth);
  properties = setBit(properties, 3, level.autoIndent);
  properties = setBit(properties, 4, level.distanceIsValue);
  properties = setBits(properties, 5, 9, level.numberFormat);
  writer.uint32(properties);
  writer.int16(level.widthAdjust);
  writer.int16(level.distance);
  writer.uint32(level.charShapeId ?? 0xffffffff);
}

function writeNumbering(numbering: Numbering): ByteWriter {
  // 아이디 매핑처럼 늘 최신(5.1) 형식으로 쓴다: 1~7수준, 시작 번호, 수준별 시작번호,
  // 8~10수준, 확장 시작번호.
  const writer = new ByteWriter();
  const levels = Array.from(
    { length: 10 },
    (_, i) => numbering.levels[i] ?? defaultNumberingLevel(i),
  );
  const writeLevel = (level: NumberingLevel) => {
    writeParagraphHead(writer, level);
    writer.string(level.format);
  };
  levels.slice(0, 7).forEach(writeLevel);
  writer.uint16(numbering.startNumber ?? 1);
  for (const level of levels.slice(0, 7)) writer.uint32(level.startNumber ?? 1);
  levels.slice(7).forEach(writeLevel);
  for (const level of levels.slice(7)) writer.uint32(level.startNumber ?? 1);
  return writer;
}

// 8~10수준은 한글이 저장한 기본값(5.1.1.0 레코드 48개에서 같았다)을 따른다:
// 속성 0x12C·0x14C·0x6C, 형식 문자열은 8수준만 `^8`.
const EXTENDED_LEVEL_DEFAULTS: Pick<
  NumberingLevel,
  "format" | "numberFormat"
>[] = [
  { format: "^8", numberFormat: NumberFormat.CircledHangulSyllable },
  { format: "", numberFormat: NumberFormat.HangulJamo },
  { format: "", numberFormat: NumberFormat.RomanLower },
];

function defaultNumberingLevel(index: number): NumberingLevel {
  const base = {
    align: HeadAlign.Left,
    widthAdjust: 0,
    distance: 50,
    autoIndent: true,
  };
  if (index < 7)
    return {
      ...base,
      format: `^${index + 1}.`,
      numberFormat: NumberFormat.Digit,
    };
  return {
    ...base,
    useInstanceWidth: true,
    ...EXTENDED_LEVEL_DEFAULTS[index - 7]!,
  };
}

function writeBullet(bullet: Bullet): ByteWriter {
  const writer = new ByteWriter();
  writeParagraphHead(writer, bullet.level);
  writer.uint16(bullet.char.charCodeAt(0));
  const { image } = bullet;
  // 명세는 이미지 ID를 적는다고 하지만 한글은 1을 쓴다. ID는 아래 uint16에 있다.
  writer.int32(image ? 1 : 0);
  writer.int8(image?.contrast ?? 0);
  writer.int8(image?.brightness ?? 0);
  writer.uint8(image?.effect ?? 0);
  writer.uint16(image ? image.binDataId + 1 : 0);
  writer.uint16(bullet.checkedChar?.charCodeAt(0) ?? 0);
  return writer;
}

/**
 * 열거형 칸 값이 0~max 정수인지 검사한다. max는 명세 범위이고, 실제 파일 154개의
 * 문단 모양 6,727개도 모두 이 안이었다.
 */
function checkEnum(value: number, max: number, what: string): number {
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new RangeError(`${what} ${value}는 0~${max} 정수여야 한다.`);
  return value;
}

function writeParaShape(shape: ParaShape): ByteWriter {
  const writer = new ByteWriter();
  const kind = checkEnum(shape.lineSpacing.kind, 3, "줄 간격 종류");
  const level = checkEnum(shape.headingLevel ?? 0, 9, "문단 수준");
  // 옛 형식에 담을 수 없는 값(46B의 최소, 46·54B의 8~10수준)이 있으면 그 레코드만 한글 5.1
  // 형식(58B)으로 올려 쓴다. 다른 레코드와 파일 버전은 그대로 둔다. 5.0.2.5 파일 안의 58B
  // 레코드에서 한글은 최소를 읽었다(정오표 E20). 끝 칸의 수준을 읽는지는 확인하지 않았다.
  const upgrade =
    (shape.recordLayout === 46 && kind === LineSpacingKind.AtLeast) ||
    (shape.recordLayout !== undefined && level > 6);
  const layout = upgrade ? undefined : shape.recordLayout;
  const short = layout === 46;

  // 옛 줄 간격 칸(속성 1 bit 0~1, 오프셋 24). 한글은 54·58B에도 쓰고, 옛 칸에 없는 최소는
  // 글자에 따라 100%로 쓴다(정오표 정정 44).
  const { value } = shape.lineSpacing;
  const oldAtLeast = !short && kind === LineSpacingKind.AtLeast;
  let properties1 = shape.unknownBits1 ?? 0;
  properties1 = setBits(
    properties1,
    0,
    1,
    oldAtLeast ? LineSpacingKind.Percent : kind,
  );
  properties1 = setBits(properties1, 2, 4, checkEnum(shape.align, 5, "정렬"));
  properties1 = setBits(
    properties1,
    5,
    6,
    checkEnum(shape.lineBreakLatin ?? 0, 2, "라틴 줄 나눔"),
  );
  properties1 = setBit(
    properties1,
    7,
    checkEnum(shape.lineBreakHangul ?? 0, 1, "한글 줄 나눔") === 1,
  );
  properties1 = setBit(properties1, 8, shape.snapToGrid);
  if (shape.condense !== undefined) {
    const condense = shape.condense;
    if (!Number.isInteger(condense) || condense < 25 || condense > 100)
      throw new RangeError(`공백 최소값 ${condense}%는 25~100% 정수여야 한다.`);
    properties1 = setBits(properties1, 9, 15, 100 - condense);
  }
  properties1 = setBit(properties1, 16, shape.widowOrphan);
  properties1 = setBit(properties1, 17, shape.keepWithNext);
  properties1 = setBit(properties1, 18, shape.keepLines);
  properties1 = setBit(properties1, 19, shape.pageBreakBefore);
  properties1 = setBits(
    properties1,
    20,
    21,
    checkEnum(shape.verticalAlign ?? 0, 3, "세로 정렬"),
  );
  properties1 = setBit(properties1, 22, shape.fontLineHeight);
  properties1 = setBits(
    properties1,
    23,
    24,
    checkEnum(shape.headingKind ?? HeadingKind.None, 3, "문단 머리 종류"),
  );
  const hasLevel = layout === undefined;
  properties1 = setBits(properties1, 25, 27, Math.min(level, 6));
  properties1 = setBit(properties1, 28, shape.border?.connect);
  properties1 = setBit(properties1, 29, shape.border?.ignoreMargin);

  writer.uint32(properties1);
  writer.int32(shape.marginLeft);
  writer.int32(shape.marginRight);
  writer.int32(shape.indent);
  writer.int32(shape.marginTop);
  writer.int32(shape.marginBottom);
  writer.int32(oldAtLeast ? 100 : value);
  writer.uint16(shape.tabDefId ?? 0);
  writer.uint16(toIdRef(shape.headingId, "문단 머리 ID"));
  writer.uint16(toIdRef(shape.border?.borderFillId, "문단 테두리 ID"));
  writer.int16(shape.border?.offsetLeft ?? 0);
  writer.int16(shape.border?.offsetRight ?? 0);
  writer.int16(shape.border?.offsetTop ?? 0);
  writer.int16(shape.border?.offsetBottom ?? 0);

  let properties2 = shape.unknownBits2 ?? 0;
  properties2 = setBit(properties2, 4, shape.autoSpaceLatin);
  properties2 = setBit(properties2, 5, shape.autoSpaceNumber);
  if (shape.singleLine !== undefined)
    properties2 = setBits(properties2, 0, 1, shape.singleLine ? 1 : 0);
  writer.uint32(properties2);

  if (!short) {
    let properties3 = shape.unknownBits3 ?? 0;
    properties3 = setBits(properties3, 0, 4, kind);
    writer.uint32(properties3);
    writer.uint32(shape.lineSpacing.value);
  }

  if (hasLevel) writer.uint32(level);
  if (shape.trailing) writer.bytes(shape.trailing);
  return writer;
}

function writeStyle(style: Style): ByteWriter {
  const writer = new ByteWriter();
  writer.string(style.name);
  writer.string(style.englishName);

  let properties = style.unknownBits ?? 0;
  if (properties & STYLE_KIND) {
    if (style.kind === StyleKind.Char) {
      throw new RangeError(`스타일 종류 칸에 모르는 값 ${properties & STYLE_KIND}이 있어 글자 스타일로 쓸 수 없습니다. unknownBits의 bit 0~2를 지우세요.`);
    }
  } else {
    properties = setBits(properties, 0, 2, style.kind === StyleKind.Char ? 1 : 0);
  }
  writer.uint8(properties);

  writer.uint8(style.nextStyleId);
  writer.int16(style.langId ?? 1042);
  writer.uint16(style.paraShapeId);
  writer.uint16(style.charShapeId);
  // 정오표 정정 49. 새 스타일은 한글처럼 0 두 바이트.
  if (style.trailing) writer.bytes(style.trailing);
  else writer.uint16(0);
  return writer;
}
