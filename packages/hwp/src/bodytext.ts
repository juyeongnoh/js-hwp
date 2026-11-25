/**
 * `BodyText/Section{N}`: 문단 스트림.
 *
 * 미묘한 부분은 `PARA_TEXT`다. 코드 0-31이 컨트롤인 UTF-16 버퍼 하나이고, 각
 * 컨트롤은 세 *형태* 중 하나를 갖는다.
 *
 * | 형태     | 코드 단위 | 배치                                  |
 * |----------|-----------|--------------------------------------|
 * | char     | 1         | 코드 하나뿐                           |
 * | inline   | 8         | `[code][페이로드 6단위][code]`        |
 * | extended | 8         | 같은 모양이고 `CTRL_HEADER`에 묶인다  |
 *
 * 확장 컨트롤은 다음 `CTRL_HEADER` 레코드를 순서대로 소비한다. 텍스트 안의 표가
 * 자기 표 레코드를 찾는 방식이 이것이다. 코드의 형태를 틀리면 문단 전체가
 * 어긋나므로, 아래 표는 빠짐없고 `docs/spec/04-bodytext-records.md`에서 곧장
 * 가져왔다.
 */

import {
  type Caption,
  type Fill,
  type Control,
  type ObjectPlacement,
  type RawChildRecord,
  type ShapeComponent,
  type ShapeLine,
  type ShapeTextBox,
  type RectangleControl,
  type LineControl,
  type EllipseControl,
  type ArcControl,
  type PolygonControl,
  type CurveControl,
  type PictureControl,
  type PictureBorder,
  type PictureEffectColor,
  type PictureEffects,
  type ShapeBase,
  type Point,
  type ShapeMatrix,
  type UnknownControl,
  FieldKind,
  type HwpDocument,
  type InlineItem,
  type Memo,
  type LineSegment,
  type Paragraph,
  type RangeTag,
  type Run,
  type NoteShape,
  type PageBorderFill,
  type PageDef,
  PageNumberStart,
  type Section,
  type SectionProperties,
  TextDirection,
  ListLineWrap,
  type ParagraphList,
  PageBreakInTable,
  RelativeTo,
  type CellZone,
  type TableCell,
  type TableRow,
  VerticalAlign,
  defaultPageDef,
  rgb,
  type LineSegmentFlag,
} from "@js-hwp/core";
import {
  ByteReader,
  ByteWriter,
  HwpFormatError,
  bit,
  bits,
  setBit,
  setBits,
  fromIdRef,
  toIdRef,
} from "./bytes.js";
import {
  type RecordNode,
  RecordWriter,
  buildRecordTree,
  childWithTag,
  parseRecords,
} from "./record.js";
import { readFill, versionNumber, writeFill } from "./docinfo.js";
import { CtrlId, SectionTag } from "./tags.js";

/** 문단 머리 단 나누기 종류에서 모델이 해석하는 비트: 0x04 쪽, 0x08 단 나누기. */
const DIVIDE_SORT_KNOWN = 0x0c;

/** 문자 코드로 인덱싱한 제어 문자 형태. */
export const CONTROL_FORM: readonly ("char" | "inline" | "extended")[] = [
  "char", // 0x00 unusable
  "extended", // 0x01 예약
  "extended", // 0x02 구역 정의/단 정의
  "extended", // 0x03 필드 시작(누름틀, 하이퍼링크, 블록 책갈피, 표 계산식, 문서 요약, 사용자 정보, 현재 날짜/시간, 문서 날짜/시간, 파일 경로, 상호 참조, 메일 머지, 메모, 교정부호, 개인정보)
  "inline", // 0x04 필드 끝
  "inline", // 0x05 예약
  "inline", // 0x06 예약
  "inline", // 0x07 예약
  "inline", // 0x08 title mark
  "inline", // 0x09 탭
  "char", // 0x0A 한 줄 끝(line break)
  "extended", // 0x0B 그리기 개체/표
  "extended", // 0x0C 예약
  "char", // 0x0D 문단 끝(para break)
  "extended", // 0x0E 예약
  "extended", // 0x0F 숨은 설명
  "extended", // 0x10 머리말/꼬리말
  "extended", // 0x11 각주/미주
  "extended", // 0x12 자동번호(각주, 표 등)
  "inline", // 0x13 예약
  "inline", // 0x14 예약
  "extended", // 0x15 페이지 컨트롤(감추기, 새 번호로 시작 등)
  "extended", // 0x16 책갈피/찾아보기 표식
  "extended", // 0x17 덧말/글자 겹침
  "char", // 0x18 하이픈
  "char", // 0x19 예약
  "char", // 0x1A 예약
  "char", // 0x1B 예약
  "char", // 0x1C 예약
  "char", // 0x1D 예약
  "char", // 0x1E 묶음 빈칸
  "char", // 0x1F 고정폭 빈칸
];

/** 파일에서 문단 리스트의 세로 정렬은 0=위, 1=가운데, 2=아래다. */
export const LIST_VERTICAL_ALIGN_FROM_WIRE = [
  VerticalAlign.Top,
  VerticalAlign.Center,
  VerticalAlign.Bottom,
];

/** 모델의 VerticalAlign으로 인덱싱한다. Baseline은 문단 리스트에 대응물이 없다. */
export const LIST_VERTICAL_ALIGN_TO_WIRE = [0, 0, 1, 2];

export const CHAR_TAB = 0x09;
export const CHAR_LINE_BREAK = 0x0a;
export const CHAR_PARA_BREAK = 0x0d;
export const CHAR_HYPHEN = 0x18;
export const CHAR_NBSP = 0x1e;
export const CHAR_FIXED_SPACE = 0x1f;
export const CHAR_TITLE_MARK = 0x08;
export const CHAR_FIELD_START = 0x03;
export const CHAR_FIELD_END = 0x04;
export const CHAR_OBJECT = 0x0b;

/** 네 글자 컨트롤 id를 읽으면서 디스크상 바이트 역순을 되돌린다. */
export function readCtrlId(value: number): string {
  return (
    String.fromCharCode((value >>> 24) & 0xff) +
    String.fromCharCode((value >>> 16) & 0xff) +
    String.fromCharCode((value >>> 8) & 0xff) +
    String.fromCharCode(value & 0xff)
  );
}

export function writeCtrlId(id: string): number {
  const padded = id.padEnd(4, " ");
  return (
    ((padded.charCodeAt(0) << 24) |
      (padded.charCodeAt(1) << 16) |
      (padded.charCodeAt(2) << 8) |
      padded.charCodeAt(3)) >>>
    0
  );
}

// ---------------------------------------------------------------------------
// 읽기
// ---------------------------------------------------------------------------

interface ParseContext {
  doc: HwpDocument;
  /** `fieldBegin`과 `fieldEnd`가 짝을 이루도록 하는 필드 id. */
  fieldStack: number[];
  nextFieldId: number;
}

/** `BodyText/Section{N}` 스트림 하나를 파싱한다. */
export function parseSection(doc: HwpDocument, data: Uint8Array): Section {
  const records = parseRecords(data);
  const tree = buildRecordTree(records);
  const context: ParseContext = { doc, fieldStack: [], nextFieldId: 1 };

  const section: Section = { pageDef: defaultPageDef(), paragraphs: [] };
  section.paragraphs = readParagraphList(tree, context, section);
  const lastParagraph = tree
    .filter((node) => node.tagId === SectionTag.ParaHeader)
    .at(-1);
  const memos = lastParagraph ? readMemos(lastParagraph, context) : [];
  if (memos.length > 0) section.memos = memos;
  if (section.paragraphs.length === 0) {
    section.paragraphs.push({
      paraShapeId: 0,
      styleId: 0,
      runs: [{ charShapeId: 0, items: [] }],
    });
  }
  return section;
}

function readParagraphList(
  nodes: RecordNode[],
  context: ParseContext,
  section?: Section,
): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const node of nodes) {
    if (node.tagId !== SectionTag.ParaHeader) continue;
    // 구역 정의와 구역의 단 정의는 첫 문단에만 있다. 뒤 문단의 `cold`(다단 설정 나누기)는
    // 구역 값을 덮지 않고 컨트롤로 남긴다.
    const first = paragraphs.length === 0 ? section : undefined;
    paragraphs.push(readParagraph(node, context, first));
  }
  return paragraphs;
}

function readParagraph(
  node: RecordNode,
  context: ParseContext,
  section?: Section,
): Paragraph {
  const reader = new ByteReader(node.payload);
  const packed = reader.uint32();
  const charCount = packed & 0x7fffffff;
  reader.uint32(); // control mask; the text itself is authoritative
  const paraShapeId = reader.uint16();
  const styleId = reader.uint8();
  const divideSort = reader.uint8();
  reader.optionalUint16(); // char shape count
  reader.optionalUint16(); // range tag count
  reader.optionalUint16(); // line align count
  const instanceId = reader.optionalUint32();
  // 5.0.3.2부터 있는 필드. 그 전 버전의 레코드는 22바이트에서 끝난다.
  const trackChangeMerged = reader.optionalUint16();

  const paragraph: Paragraph = { paraShapeId, styleId, runs: [] };
  if (instanceId) paragraph.id = instanceId;
  if (trackChangeMerged) paragraph.trackChangeMerged = trackChangeMerged;
  // 표 59: 0x01 구역, 0x02 다단, 0x04 쪽, 0x08 단 나누기. Windows 한글 13.0에서 네 비트 모두 확인했다.
  if (bit(divideSort, 2)) paragraph.pageBreak = true;
  if (bit(divideSort, 3)) paragraph.columnBreak = true;
  const divideSortUnknownBits = divideSort & ~DIVIDE_SORT_KNOWN;
  if (divideSortUnknownBits)
    paragraph.divideSortUnknownBits = divideSortUnknownBits;

  const textRecord = childWithTag(node, SectionTag.ParaText);
  const charShapeRecord = childWithTag(node, SectionTag.ParaCharShape);
  const lineSegRecord = childWithTag(node, SectionTag.ParaLineSeg);
  const rangeTagRecord = childWithTag(node, SectionTag.ParaRangeTag);
  const controlNodes = node.children.filter(
    (child) => child.tagId === SectionTag.CtrlHeader,
  );

  const charShapes = charShapeRecord ? readParaCharShape(charShapeRecord) : [];
  const items = textRecord
    ? readParaText(
        textRecord.payload,
        controlNodes,
        context,
        section,
        charCount,
      )
    : [];

  paragraph.runs = buildRuns(items, charShapes);
  // 문단 끝 글자(0x0D)는 아이템이 없으므로 그 자리의 글자 모양을 따로 둔다. 빈 문단은 run이 맡는다.
  const paraEndShapeId = charShapeAt(charShapes, charCount - 1);
  const lastRun = paragraph.runs[paragraph.runs.length - 1];
  if (!lastRun) paragraph.runs.push({ charShapeId: paraEndShapeId, items: [] });
  else if (lastRun.charShapeId !== paraEndShapeId)
    paragraph.paraEndCharShapeId = paraEndShapeId;
  // 구역 첫 문단의 secd·cold 자리(위치 0)도 아이템이 없다.
  const hasSectionDefinition = controlNodes.some(
    (child) =>
      readCtrlId(new ByteReader(child.payload).uint32()) ===
      CtrlId.SectionDefinition,
  );
  if (hasSectionDefinition) {
    const sectionShapeId = charShapeAt(charShapes, 0);
    if (sectionShapeId !== paragraph.runs[0]!.charShapeId)
      paragraph.sectionControlCharShapeId = sectionShapeId;
  }
  // 레코드가 없어도 빈 배열로 둔다. 쓸 때 줄 배치를 새로 만들지 않고 없던 그대로 쓰게 한다.
  paragraph.lineSegments = lineSegRecord ? readParaLineSeg(lineSegRecord) : [];
  if (rangeTagRecord) paragraph.rangeTags = readParaRangeTag(rangeTagRecord);
  return paragraph;
}

const LINE_SEGMENT_KNOWN = 0x003f0003;

/** 표 62. 36바이트 항목이 문단 머리의 줄 정보 수만큼 이어진다. */
function readParaLineSeg(node: RecordNode): LineSegment[] {
  const reader = new ByteReader(node.payload);
  const out: LineSegment[] = [];
  while (reader.hasMore(36)) {
    const lineSeg = {
      textStart: reader.uint32(),
      y: reader.int32(),
      height: reader.int32(),
      textHeight: reader.int32(),
      baselineGap: reader.int32(),
      lineSpacing: reader.int32(),
      x: reader.int32(),
      width: reader.int32(),
    };
    const flags = reader.uint32();
    const flag: LineSegmentFlag = {
      firstLineInPage: bit(flags, 0),
      firstLineInColumn: bit(flags, 1),
      emptySegment: bit(flags, 16),
      firstSegmentInLine: bit(flags, 17),
      lastSegmentInLine: bit(flags, 18),
      autoHyphenation: bit(flags, 19),
      indentation: bit(flags, 20),
      headingApplied: bit(flags, 21),
    };
    const unknownBits = (flags & ~LINE_SEGMENT_KNOWN) >>> 0;
    if (unknownBits) flag.unknownBits = unknownBits;
    out.push({
      ...lineSeg,
      flags: flag,
    });
  }
  return out;
}

/** 표 63. 12바이트 항목. 태그의 상위 8비트가 종류, 하위 24비트가 데이터. */
function readParaRangeTag(node: RecordNode): RangeTag[] {
  const reader = new ByteReader(node.payload);
  const out: RangeTag[] = [];
  while (reader.hasMore(12)) {
    const start = reader.uint32();
    const end = reader.uint32();
    const tag = reader.uint32();
    out.push({ start, end, kind: tag >>> 24, data: tag & 0xffffff });
  }
  return out;
}

function readParaCharShape(
  node: RecordNode,
): { position: number; charShapeId: number }[] {
  const reader = new ByteReader(node.payload);
  const out: { position: number; charShapeId: number }[] = [];
  while (reader.hasMore(8)) {
    out.push({ position: reader.uint32(), charShapeId: reader.uint32() });
  }
  return out;
}

/** 인라인 항목과 그것이 시작하는 문자 오프셋. */
interface PositionedItem {
  position: number;
  item: InlineItem;
}

function readParaText(
  payload: Uint8Array,
  controlNodes: RecordNode[],
  context: ParseContext,
  section: Section | undefined,
  declaredCharCount: number,
): PositionedItem[] {
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );

  // WCHAR(2바이트) 칸의 개수
  const total = Math.min(
    Math.floor(payload.byteLength / 2),
    declaredCharCount || Infinity,
  );

  const items: PositionedItem[] = [];
  let controlIndex = 0;
  let pending = "";
  let pendingStart = 0;
  let position = 0;

  const flush = (): void => {
    if (pending === "") return;
    items.push({
      position: pendingStart,
      item: { type: "text", value: pending },
    });
    pending = "";
  };

  while (position < total) {
    const code = view.getUint16(position * 2, true);

    // 컨트롤 문자가 아닌 일반 문자일 때
    if (code >= 32) {
      if (pending === "") pendingStart = position;
      pending += String.fromCharCode(code);
      position++;
      continue;
    }

    const form = CONTROL_FORM[code] ?? "char";
    flush();

    if (form === "char") {
      const item = charControlItem(code);
      if (item) items.push({ position, item });
      position++;
      continue;
    }

    // 인라인과 확장 컨트롤 둘 다 8 코드 단위를 차지한다.
    const start = position;
    position += 8;

    if (form === "extended") {
      // 파라미터로 넘겨받은 컨트롤 레코드
      const node = controlNodes[controlIndex++];
      const control = node ? readControl(node, context, section) : undefined;
      // 모르는 컨트롤은 텍스트의 제어 문자도 원본대로 다시 쓴다.
      if (control?.type === "unknown") control.charCode = code;
      // 필드는 텍스트 쪽 ctrlId가 CTRL_HEADER와 다를 수 있다(정오표 71).
      if (control?.type === "fieldBegin") {
        control.textData = textData(view, start);
        const kind =
          FIELD_KIND_BY_CTRL_ID[
            readCtrlId(view.getUint32((start + 1) * 2, true))
          ];
        if (control.fieldKind === FieldKind.Unknown && kind !== undefined)
          control.fieldKind = kind;
      }
      if (control) items.push({ position: start, item: control });
      continue;
    }

    const item = inlineControlItem(code, view, start, context);
    if (item) items.push({ position: start, item });
  }
  flush();

  return items;
}

function charControlItem(code: number): InlineItem | undefined {
  switch (code) {
    case CHAR_LINE_BREAK:
      return { type: "lineBreak" };
    case CHAR_HYPHEN:
      return { type: "specialChar", char: "hyphen" };
    case CHAR_NBSP:
      return { type: "specialChar", char: "nbsp" };
    case CHAR_FIXED_SPACE:
      return { type: "specialChar", char: "fixedWidthSpace" };
    default:
      // 0x0D는 문단을 끝내고 0x00은 나타나면 안 된다.
      return undefined;
  }
}

function inlineControlItem(
  code: number,
  view: DataView,
  start: number,
  context: ParseContext,
): InlineItem | undefined {
  switch (code) {
    case CHAR_TAB: {
      const width = view.getUint32((start + 1) * 2, true);
      return {
        type: "tab",
        width: width || undefined,
        textData: textData(view, start),
      };
    }
    case CHAR_TITLE_MARK:
      return { type: "specialChar", char: "titleMark" };
    case CHAR_FIELD_END: {
      const id = context.fieldStack.pop();
      return id === undefined
        ? undefined
        : { type: "fieldEnd", id, textData: textData(view, start) };
    }
    default:
      return undefined;
  }
}

/** 인라인·확장 컨트롤 문자 뒤의 코드 단위 6개. */
function textData(view: DataView, start: number): number[] {
  return Array.from({ length: 6 }, (_, i) =>
    view.getUint16((start + 1 + i) * 2, true),
  );
}

function readControl(
  node: RecordNode,
  context: ParseContext,
  section: Section | undefined,
): Control | undefined {
  const reader = new ByteReader(node.payload);
  const ctrlId = readCtrlId(reader.uint32());

  switch (ctrlId) {
    case CtrlId.SectionDefinition:
      if (section) {
        readSectionDefinition(node, section, context);
        return undefined;
      }
      break;
    case CtrlId.ColumnDefinition:
      if (section) {
        readColumnDefinition(reader, section);
        return undefined;
      }
      break;
    case CtrlId.Table:
      return readTable(node, reader, context);
    case CtrlId.Header:
    case CtrlId.Footer: {
      const props = reader.optionalUint32();
      const control: Extract<Control, { type: "header" | "footer" }> = {
        type: ctrlId === CtrlId.Header ? "header" : "footer",
        applyTo: bits(props, 0, 1),
        ...readNestedParagraphs(node, context),
      };
      const unknownBits = (props & ~0x3) >>> 0;
      if (unknownBits) control.unknownBits = unknownBits;
      if (reader.hasMore()) control.trailing = reader.rest();
      return control;
    }
    case CtrlId.Footnote:
    case CtrlId.Endnote:
    case CtrlId.HiddenComment: {
      const control: Extract<
        Control,
        { type: "footnote" | "endnote" | "hiddenComment" }
      > = {
        type:
          ctrlId === CtrlId.Footnote
            ? "footnote"
            : ctrlId === CtrlId.Endnote
              ? "endnote"
              : "hiddenComment",
        ...readNestedParagraphs(node, context),
      };
      if (reader.hasMore()) control.trailing = reader.rest();
      return control;
    }
    case CtrlId.Bookmark:
      return { type: "bookmark", name: readBookmarkName(node) };
    case CtrlId.AutoNumber:
      return readAutoNumber(reader);
    case CtrlId.PageHiding:
      return readPageHiding(reader.optionalUint32());
    case CtrlId.DrawingObject:
      return readDrawingObject(node, context);
    default:
      if (ctrlId.startsWith("%"))
        return readField(ctrlId, node, reader, context);
  }
  return {
    type: "unknown",
    ctrlId,
    raw: node.payload,
    ...rawChildRecords(node, node.children),
  };
}

/**
 * 모델이 해석하지 않는 컨트롤의 하위 레코드를 문서 순서대로 평탄화한다. 깊이는 원본 레벨에서
 * 구하므로 레벨이 건너뛰어도 그대로 다시 쓴다.
 */
function rawChildRecords(
  control: RecordNode,
  children: RecordNode[],
): { childRecords?: RawChildRecord[] } {
  const out: RawChildRecord[] = [];
  const base = control.level + 1;
  const visit = (n: RecordNode): void => {
    out.push({ tagId: n.tagId, depth: n.level - base, payload: n.payload });
    n.children.forEach(visit);
  };
  children.forEach(visit);
  return out.length ? { childRecords: out } : {};
}

function readField(
  ctrlId: string,
  node: RecordNode,
  reader: ByteReader,
  context: ParseContext,
): Control {
  // 표 154: 속성 4B, 기타 속성 1B, 명령 길이 2B + WCHAR, 고유 아이디 4B. 그 뒤 바이트는 보존한다.
  const properties = reader.optionalUint32();
  const extraProperties = reader.optionalUint8();
  const command = reader.optionalString();
  const instanceId = reader.optionalUint32();

  const id = context.nextFieldId++;
  context.fieldStack.push(id);

  const control: Extract<Control, { type: "fieldBegin" }> = {
    type: "fieldBegin",
    fieldKind: FIELD_KIND_BY_CTRL_ID[ctrlId] ?? FieldKind.Unknown,
    id,
    ctrlId,
  };
  if (command) control.command = command;
  if (instanceId) control.instanceId = instanceId;
  if (bit(properties, 0)) control.editable = true;
  if (bit(properties, 15)) control.dirty = true;
  const unknownBits = (properties & ~FIELD_KNOWN) >>> 0;
  if (unknownBits) control.unknownBits = unknownBits;
  if (extraProperties) control.extraProperties = extraProperties;
  if (reader.hasMore()) control.trailing = reader.rest();
  const dataNode = childWithTag(node, SectionTag.CtrlData);
  if (dataNode) control.ctrlData = dataNode.payload;
  return control;
}

/** 표 155에서 모델이 이름으로 다루는 비트: 0(수정 가능), 15(수정됨). */
const FIELD_KNOWN = 0x8001;

/** 읽은 ctrlId가 있으면 그것을, 없으면 필드 종류의 ctrlId를 쓴다. 모르는 종류는 하이퍼링크다. */
function fieldCtrlId(
  control: Extract<Control, { type: "fieldBegin" }>,
): string {
  return (
    control.ctrlId ??
    Object.entries(FIELD_KIND_BY_CTRL_ID).find(
      ([, kind]) => kind === control.fieldKind,
    )?.[0] ??
    CtrlId.FieldHyperlink
  );
}

const FIELD_KIND_BY_CTRL_ID: Record<string, number> = {
  [CtrlId.FieldDate]: 1,
  [CtrlId.FieldDocDate]: 2,
  [CtrlId.FieldPath]: 3,
  [CtrlId.FieldBookmark]: 4,
  [CtrlId.FieldMailMerge]: 5,
  [CtrlId.FieldCrossRef]: 6,
  [CtrlId.FieldFormula]: 7,
  [CtrlId.FieldClickHere]: 8,
  [CtrlId.FieldSummary]: 9,
  [CtrlId.FieldUserInfo]: 10,
  [CtrlId.FieldHyperlink]: 11,
  [CtrlId.FieldMemo]: 22,
  [CtrlId.FieldPrivateInfo]: 23,
  [CtrlId.FieldTableOfContents]: 24,
};

function readBookmarkName(node: RecordNode): string {
  const dataNode = childWithTag(node, SectionTag.CtrlData);
  if (!dataNode) return "";
  const reader = new ByteReader(dataNode.payload);
  // 책갈피 이름은 파라미터 셋 안에 있다. 첫 문자열이 그것이다.
  reader.optionalUint32();
  return reader.optionalString();
}

/**
 * 문단 리스트 헤더(표 65)를 읽은 결과. 문단 수는 명세의 INT16이 아니라 INT32이고, 속성 UINT32는
 * 오프셋 4다(정정 83, experiments/list-header-para-count). 문단은 LIST_HEADER 뒤의 형제 레코드라
 * 호출하는 쪽이 읽는다.
 */
interface ListHeaderRead {
  /** 리스트 속성을 해석한 모델 필드. */
  list: Omit<ParagraphList, "paragraphs">;
  /** 속성 다음 위치에 있는 리더. 셀·캡션처럼 뒤에 필드가 더 있을 때 이어 읽는다. */
  reader: ByteReader;
}

/** 문단 리스트 속성(표 65)에서 모든 리스트에 공통인 bit 0~6(정정 85). */
const LIST_PROPERTIES_MASK = 0b1111111;
const LIST_VERTICAL_ALIGN_MASK = 0b11 << 5;

/**
 * 문단 리스트 헤더(문단 수 UINT32, 속성 UINT32, 정정 83)를 읽는다. 한글은 읽을 때 문단 수를 쓰지
 * 않으므로 코덱도 문단 수를 버리고 문단을 레코드 구조로 나눈다.
 *
 * 속성은 bit 0~2 글자 방향, bit 3~4 줄바꿈, bit 5~6 세로 정렬로 읽는다. 기본값(가로, 일반 줄바꿈)은
 * 필드를 두지 않는다. 세로 정렬은 0~2면 늘 필드로 두고, 범위 밖 3은 bit 7~31과 함께
 * `listUnknownBits`에 남긴다.
 */
function readListHeader(payload: Uint8Array): ListHeaderRead {
  const reader = new ByteReader(payload);
  reader.optionalUint32();
  const properties = reader.optionalUint32();

  const list: Omit<ParagraphList, "paragraphs"> = {};
  const textDirection = bits(properties, 0, 2);
  if (textDirection !== TextDirection.Horizontal)
    list.textDirection = textDirection;
  const lineWrap = bits(properties, 3, 4);
  if (lineWrap !== ListLineWrap.Break) list.lineWrap = lineWrap;
  const verticalAlign = LIST_VERTICAL_ALIGN_FROM_WIRE[bits(properties, 5, 6)];
  if (verticalAlign !== undefined) list.verticalAlign = verticalAlign;
  let unknownBits = (properties & ~LIST_PROPERTIES_MASK) >>> 0;
  if (verticalAlign === undefined)
    unknownBits = (unknownBits | LIST_VERTICAL_ALIGN_MASK) >>> 0;
  if (unknownBits) list.listUnknownBits = unknownBits;
  return { list, reader };
}

/**
 * {@link readListHeader}가 읽는 리스트 속성의 반대. `listUnknownBits`의 bit 7~31을 그대로 두고
 * bit 0~6을 필드로 채운다. 세로 정렬이 없으면 `listUnknownBits`에 남은 범위 밖 값(3)을, 그것도
 * 없으면 `defaultAlign`을 쓴다.
 */
function listPropertiesBits(
  list: Omit<ParagraphList, "paragraphs">,
  defaultAlign: VerticalAlign,
): number {
  const unknownBits = list.listUnknownBits ?? 0;
  let properties = unknownBits & ~LIST_PROPERTIES_MASK;
  properties = setBits(properties, 0, 2, list.textDirection ?? 0);
  properties = setBits(properties, 3, 4, list.lineWrap ?? ListLineWrap.Break);
  const align =
    list.verticalAlign === undefined && bits(unknownBits, 5, 6) === 3
      ? 3
      : (LIST_VERTICAL_ALIGN_TO_WIRE[list.verticalAlign ?? defaultAlign] ?? 0);
  return setBits(properties, 5, 6, align) >>> 0;
}

/** 문단 리스트 헤더 앞 8바이트를 쓴다: 문단 수 UINT32, 속성 UINT32. */
function writeListHeader(
  writer: ByteWriter,
  paragraphCount: number,
  properties: number,
): ByteWriter {
  return writer.uint32(paragraphCount).uint32(properties >>> 0);
}

/**
 * 문단 리스트 헤더 뒤를 해석하지 않는 리스트(머리말·꼬리말, 각주·미주, 숨은 설명, 바탕쪽, 메모).
 * 헤더 8바이트 뒤의 바이트는 `listTrailing`으로 보존한다.
 */
type OpaqueParagraphList = ParagraphList & { listTrailing?: Uint8Array };

/**
 * LIST_HEADER로 시작하는 문단 리스트들을 읽는다. 한글은 문단을 LIST_HEADER의 자식이
 * 아니라 같은 레벨의 형제로 뒤에 둔다(정오표 53, 68). 다음 LIST_HEADER까지의 문단이
 * 그 리스트의 문단이다.
 */
function readParagraphLists(
  children: RecordNode[],
  context: ParseContext,
): OpaqueParagraphList[] {
  const lists: OpaqueParagraphList[] = [];
  let current: OpaqueParagraphList | undefined;
  for (const child of children) {
    if (child.tagId === SectionTag.ListHeader) {
      const { list, reader } = readListHeader(child.payload);
      current = { ...list, paragraphs: [] };
      const trailing = reader.rest();
      if (trailing.length > 0) current.listTrailing = trailing.slice();
      lists.push(current);
    } else if (child.tagId === SectionTag.ParaHeader && current) {
      current.paragraphs.push(readParagraph(child, context));
    }
  }
  return lists;
}

/**
 * 문단 아래의 메모. MEMO_LIST(4B)마다 뒤따르는 LIST_HEADER와 형제 문단이 메모 하나다(정오표 71).
 */
function readMemos(paragraph: RecordNode, context: ParseContext): Memo[] {
  const memos: Memo[] = [];
  const children = paragraph.children;
  children.forEach((child, index) => {
    if (child.tagId !== SectionTag.MemoList) return;
    const end = children.findIndex(
      (next, i) => i > index && next.tagId === SectionTag.MemoList,
    );
    const [list] = readParagraphLists(
      children.slice(index + 1, end === -1 ? undefined : end),
      context,
    );
    memos.push({
      id: new ByteReader(child.payload).optionalUint32(),
      ...(list ?? { paragraphs: [] }),
    });
  });
  return memos;
}

/** 컨트롤 하나에 딸린 문단 리스트. 문단이 없으면 빈 문단 하나를 둔다. */
function readNestedParagraphs(
  node: RecordNode,
  context: ParseContext,
): OpaqueParagraphList {
  const [list] = readParagraphLists(node.children, context);
  const paragraphs = list?.paragraphs.length
    ? list.paragraphs
    : [{ paraShapeId: 0, styleId: 0, runs: [{ charShapeId: 0, items: [] }] }];
  return { ...list, paragraphs };
}

/** 표 143 bit 0~12. */
const AUTO_NUMBER_KNOWN = 0x1fff;

/** 표 142. 앞뒤 장식은 한 글자다. */
function readAutoNumber(reader: ByteReader): Control {
  const props = reader.optionalUint32();
  const control: Extract<Control, { type: "autoNumber" }> = {
    type: "autoNumber",
    numberKind: bits(props, 0, 3),
    numberFormat: bits(props, 4, 11),
  };
  const number = reader.optionalUint16();
  const userChar = reader.optionalUint16();
  const prefix = reader.optionalUint16();
  const suffix = reader.optionalUint16();
  if (number) control.number = number;
  if (userChar) control.userChar = String.fromCharCode(userChar);
  if (prefix) control.prefix = String.fromCharCode(prefix);
  if (suffix) control.suffix = String.fromCharCode(suffix);
  if (bit(props, 12)) control.supscript = true;
  const unknownBits = (props & ~AUTO_NUMBER_KNOWN) >>> 0;
  if (unknownBits) control.unknownBits = unknownBits;
  return control;
}

/** 표 145 bit 0~5(정오표 E24). */
const PAGE_HIDING_KNOWN = 0x3f;

/** 표 145. 속성은 명세의 2바이트가 아니라 4바이트다(정오표 62). */
function readPageHiding(props: number): Control {
  const control: Extract<Control, { type: "pageHiding" }> = {
    type: "pageHiding",
  };
  if (bit(props, 0)) control.hideHeader = true;
  if (bit(props, 1)) control.hideFooter = true;
  if (bit(props, 2)) control.hideMasterPage = true;
  if (bit(props, 3)) control.hideBorder = true;
  if (bit(props, 4)) control.hideFill = true;
  if (bit(props, 5)) control.hidePageNumber = true;
  const unknownBits = (props & ~PAGE_HIDING_KNOWN) >>> 0;
  if (unknownBits) control.unknownBits = unknownBits;
  return control;
}

/** 표 130에서 모델이 이름으로 다루는 비트: 0~5, 8~9, 19, 20~21(정오표 E23, E25, E26). */
const SECTION_KNOWN = 0x0030033f | (1 << 19);
/** 표 134 bit 0~13. */
const NOTE_SHAPE_KNOWN = 0x3fff;
/** 표 136 bit 0~4. */
const PAGE_BORDER_FILL_KNOWN = 0x1f;
/** 표 132 bit 0~2. */
const PAGE_DEF_KNOWN = 0x07;

function readSectionDefinition(
  node: RecordNode,
  section: Section,
  context: ParseContext,
): void {
  const reader = new ByteReader(node.payload);
  reader.uint32(); // ctrlId
  const props = reader.optionalUint32();
  const properties: SectionProperties = {
    columnSpacing: reader.optionalInt16(),
    lineGrid: reader.optionalInt16(),
    charGrid: reader.optionalInt16(),
    defaultTabStop: reader.optionalUint32(),
  };
  const numberingRef = reader.optionalUint16();
  const page = reader.optionalUint16();
  const picture = reader.optionalUint16();
  const table = reader.optionalUint16();
  const equation = reader.optionalUint16();
  if (reader.hasMore(2)) properties.language = reader.uint16();
  if (reader.hasMore()) properties.trailing = reader.rest();
  readSectionTrailing(properties);

  if (bit(props, 0)) properties.hideFirstHeader = true;
  if (bit(props, 1)) properties.hideFirstFooter = true;
  if (bit(props, 2)) properties.hideFirstMasterPage = true;
  if (bit(props, 3)) properties.hideFirstPageBorder = true;
  if (bit(props, 4)) properties.hideFirstPageFill = true;
  if (bit(props, 5)) properties.hideFirstPageNumber = true;
  if (bit(props, 8)) properties.showFirstPageBorderOnly = true;
  if (bit(props, 9)) properties.showFirstPageFillOnly = true;
  if (bit(props, 19)) properties.hideEmptyLines = true;
  properties.pageNumberStart = bits(props, 20, 21);
  const unknownBits = (props & ~SECTION_KNOWN) >>> 0;
  if (unknownBits) properties.unknownBits = unknownBits;

  // 번호 문단 모양은 1부터 센다(정오표 56, 추정). 시작 번호 0은 앞 구역에 이어서다.
  const outlineNumberingId = fromIdRef(numberingRef);
  if (outlineNumberingId !== undefined)
    properties.outlineNumberingId = outlineNumberingId;
  const startNumbers = {
    ...(page && { page }),
    ...(picture && { picture }),
    ...(table && { table }),
    ...(equation && { equation }),
  };
  if (Object.keys(startNumbers).length > 0)
    properties.startNumbers = startNumbers;
  section.properties = properties;

  const pageDefNode = childWithTag(node, SectionTag.PageDef);
  if (pageDefNode) section.pageDef = readPageDef(pageDefNode);

  const notes = node.children.filter(
    (child) => child.tagId === SectionTag.FootnoteShape,
  );
  if (notes[0]) section.footnoteShape = readNoteShape(notes[0]);
  if (notes[1]) section.endnoteShape = readNoteShape(notes[1]);

  const borderFills = node.children.filter(
    (child) => child.tagId === SectionTag.PageBorderFill,
  );
  if (borderFills.length > 0)
    section.pageBorderFills = borderFills.map(readPageBorderFill);

  const masterPages = readParagraphLists(node.children, context);
  if (masterPages.length > 0) section.masterPages = masterPages;
}

/**
 * 표 129의 26B 뒤 영역(`trailing`)에서 메모 모양 ID(오프셋 4, UINT16)와 오프셋 6의 글자 방향
 * (bit 1~3), 머리말/꼬리말 세로쓰기(bit 4)를 읽는다(정오표 64, 70, E27, E28).
 */
function readSectionTrailing(properties: SectionProperties): void {
  const trailing = properties.trailing;
  if (!trailing || trailing.length < 7) return;
  const memoShapeId = fromIdRef(trailing[4]! | (trailing[5]! << 8));
  if (memoShapeId !== undefined) properties.memoShapeId = memoShapeId;
  const textDirection = bits(trailing[6]!, 1, 3);
  if (textDirection !== TextDirection.Horizontal)
    properties.textDirection = textDirection;
  if (bit(trailing[6]!, 4)) properties.verticalHeaderFooter = true;
}

/**
 * {@link readSectionTrailing}이 읽는 필드를 `trailing` 사본에 덮어쓴다. `trailing`이 없으면 `length`
 * 바이트로 만든다. 7바이트보다 짧은 `trailing`은 필드를 쓸 때만 늘린다.
 */
function sectionTrailingBytes(
  p: SectionProperties,
  length: number,
): Uint8Array {
  const source = p.trailing ?? new Uint8Array(length);
  const hasFields =
    p.memoShapeId !== undefined ||
    (p.textDirection ?? TextDirection.Horizontal) !==
      TextDirection.Horizontal ||
    p.verticalHeaderFooter === true;
  if (source.length < 7 && !hasFields) return source;
  const trailing = new Uint8Array(Math.max(source.length, 7));
  trailing.set(source);
  const memoShapeRef = toIdRef(p.memoShapeId, "메모 모양");
  trailing[4] = memoShapeRef & 0xff;
  trailing[5] = memoShapeRef >>> 8;
  let flags = setBits(
    trailing[6]!,
    1,
    3,
    p.textDirection ?? TextDirection.Horizontal,
  );
  flags = setBit(flags, 4, p.verticalHeaderFooter);
  trailing[6] = flags;
  return trailing;
}

function readPageDef(node: RecordNode): PageDef {
  const reader = new ByteReader(node.payload);
  const width = reader.hwpUnit();
  const height = reader.hwpUnit();
  const left = reader.hwpUnit();
  const right = reader.hwpUnit();
  const top = reader.hwpUnit();
  const bottom = reader.hwpUnit();
  const header = reader.hwpUnit();
  const footer = reader.hwpUnit();
  const gutter = reader.hwpUnit();
  const properties = reader.optionalUint32();

  const pageDef: PageDef = {
    width,
    height,
    margins: { left, right, top, bottom, header, footer, gutter },
    landscape: bit(properties, 0),
    gutterKind: bits(properties, 1, 2),
  };
  const unknownBits = (properties & ~PAGE_DEF_KNOWN) >>> 0;
  if (unknownBits) pageDef.unknownBits = unknownBits;
  return pageDef;
}

/** 표 133. 구분선 길이는 4바이트다(정오표 59). */
function readNoteShape(node: RecordNode): NoteShape {
  const reader = new ByteReader(node.payload);
  const props = reader.optionalUint32();
  const userChar = reader.optionalUint16();
  const prefix = reader.optionalUint16();
  const suffix = reader.optionalUint16();
  const shape: NoteShape = {
    numberFormat: bits(props, 0, 7),
    startNumber: reader.optionalUint16(),
    placement: bits(props, 8, 9),
    numbering: bits(props, 10, 11),
    separatorLength: reader.optionalInt32(),
    aboveSpacing: reader.optionalInt16(),
    belowSpacing: reader.optionalInt16(),
    betweenSpacing: reader.optionalInt16(),
    separatorStyle: reader.optionalUint8(),
    separatorWidth: reader.optionalUint8(),
    separatorColor: reader.optionalColor(),
  };
  if (userChar) shape.userChar = String.fromCharCode(userChar);
  if (prefix) shape.prefix = String.fromCharCode(prefix);
  if (suffix) shape.suffix = String.fromCharCode(suffix);
  if (bit(props, 12)) shape.superscript = true;
  if (bit(props, 13)) shape.beneathText = true;
  const unknownBits = (props & ~NOTE_SHAPE_KNOWN) >>> 0;
  if (unknownBits) shape.unknownBits = unknownBits;
  return shape;
}

/** 표 135. 전체 길이는 14바이트다(정오표 60). */
function readPageBorderFill(node: RecordNode): PageBorderFill {
  const reader = new ByteReader(node.payload);
  const props = reader.optionalUint32();
  const fill: PageBorderFill = {
    fillArea: bits(props, 3, 4),
    offsetLeft: reader.optionalInt16(),
    offsetRight: reader.optionalInt16(),
    offsetTop: reader.optionalInt16(),
    offsetBottom: reader.optionalInt16(),
  };
  if (bit(props, 0)) fill.relativeToPage = true;
  if (bit(props, 1)) fill.includeHeader = true;
  if (bit(props, 2)) fill.includeFooter = true;
  // 테두리/배경 ID는 다른 레코드처럼 1부터 센다고 보고 0을 없음으로 둔다(정오표 E23, 미확인).
  const borderFillId = fromIdRef(reader.optionalUint16());
  if (borderFillId !== undefined) fill.borderFillId = borderFillId;
  const unknownBits = (props & ~PAGE_BORDER_FILL_KNOWN) >>> 0;
  if (unknownBits) fill.unknownBits = unknownBits;
  return fill;
}

function readColumnDefinition(reader: ByteReader, section: Section): void {
  const properties = reader.optionalUint16();
  const count = bits(properties, 2, 9);
  if (count <= 1) return;
  section.columnDef = {
    count,
    kind: bits(properties, 0, 1),
    direction: bits(properties, 10, 11),
    sameWidth: bit(properties, 12),
    gap: reader.optionalUint16(),
  };
}

/** 표 속성(표 76)에서 필드로 읽는 bit 0~1(쪽 경계에서 나눔), 2(제목 줄 자동 반복), 3(`noAdjust`). */
const TABLE_PROPERTIES_KNOWN = 0b1111;

function readTable(
  node: RecordNode,
  reader: ByteReader,
  context: ParseContext,
): Control {
  const placement = readObjectPlacement(reader);

  const tableNode = childWithTag(node, SectionTag.Table);
  const rowSizes: number[] = [];
  let rowCount = 0;
  let colCount = 0;
  let cellSpacing = 0;
  let margins = { left: 0, right: 0, top: 0, bottom: 0 };
  let borderFillRef = 0;
  let pageBreak = 0;
  let repeatHeaderRows = 0;
  let noAdjust = false;
  let unknownBits = 0;
  const cellZones: CellZone[] = [];

  if (tableNode) {
    const t = new ByteReader(tableNode.payload);
    const properties = t.uint32();
    rowCount = t.uint16();
    colCount = t.uint16();
    cellSpacing = t.hwpUnit16();
    margins = {
      left: t.hwpUnit16(),
      right: t.hwpUnit16(),
      top: t.hwpUnit16(),
      bottom: t.hwpUnit16(),
    };
    for (let i = 0; i < rowCount && t.hasMore(2); i++)
      rowSizes.push(t.uint16());
    borderFillRef = t.optionalUint16();
    // Valid Zone Info Size와 영역 속성(표 78)은 5.0.1.0부터 있다. 짧은 레코드는 있는 만큼 읽는다.
    const zoneCount = t.optionalUint16();
    for (let i = 0; i < zoneCount && t.hasMore(10); i++) {
      const zone: CellZone = {
        startCol: t.uint16(),
        startRow: t.uint16(),
        endCol: t.uint16(),
        endRow: t.uint16(),
      };
      const borderFillId = fromIdRef(t.uint16());
      if (borderFillId !== undefined) zone.borderFillId = borderFillId;
      cellZones.push(zone);
    }
    pageBreak = bits(properties, 0, 1);
    repeatHeaderRows = bit(properties, 2) ? 1 : 0;
    noAdjust = bit(properties, 3);
    unknownBits = (properties & ~TABLE_PROPERTIES_KNOWN) >>> 0;
  }

  // 셀의 문단은 LIST_HEADER의 자식이 아니라 같은 레벨의 뒤따르는 레코드다. 다음
  // LIST_HEADER까지의 문단이 그 셀(또는 캡션)의 문단이다. 한글처럼 문단 수는 쓰지 않는다.
  const rows: TableRow[] = Array.from(
    { length: Math.max(rowCount, 1) },
    () => ({ cells: [] }),
  );
  // TABLE 레코드보다 앞에 오는 LIST_HEADER는 셀이 아니라 캡션이다.
  const caption = readLeadingCaption(node, SectionTag.Table, context);
  let seenTable = false;
  // 지금 문단을 채우는 셀. 바로 앞 LIST_HEADER의 셀이다.
  let current: TableCell | undefined;
  for (const child of node.children) {
    if (child.tagId === SectionTag.Table) {
      seenTable = true;
      current = undefined;
    } else if (!seenTable) {
      continue;
    } else if (child.tagId === SectionTag.ListHeader) {
      current = readTableCell(child);
      const row = rows[current.row] ?? rows[rows.length - 1];
      row?.cells.push(current);
    } else if (child.tagId === SectionTag.ParaHeader && current) {
      current.paragraphs.push(readParagraph(child, context));
    }
  }

  return {
    type: "table",
    placement: caption ? { ...placement, caption } : placement,
    rows: rows.filter((row) => row.cells.length > 0),
    cellMargins: margins,
    cellSpacing,
    ...idRefField(borderFillRef),
    pageBreak,
    repeatHeaderRows,
    ...(noAdjust ? { noAdjust } : {}),
    ...(unknownBits ? { unknownBits } : {}),
    ...(cellZones.length > 0 ? { cellZones } : {}),
  };
}

/**
 * 캡션 LIST_HEADER: 문단 리스트 헤더 8바이트(문단 수 UINT32, 리스트 속성 UINT32), 캡션 속성 UINT32,
 * 캡션 폭 HWPUNIT, 틀과의 간격 HWPUNIT16, 텍스트 최대 길이 HWPUNIT(표 72), 나머지(한글 2024는
 * 0 8바이트). 문단은 이 레코드의 형제로 뒤따른다(정정 84).
 */
function readCaption(node: RecordNode): Caption {
  const { list, reader } = readListHeader(node.payload);
  const properties = reader.optionalUint32();
  const width = reader.optionalUint32();
  const gap = reader.optionalUint16();
  const maxWidth = reader.optionalUint32();
  return {
    ...list,
    side: bits(properties, 0, 1),
    fullSize: bit(properties, 2),
    width,
    gap,
    maxWidth,
    paragraphs: [],
    unknownBits: (properties & ~0b111) >>> 0,
    trailing: Array.from(reader.rest()),
  };
}

/**
 * 개체 CTRL_HEADER의 자식 중 `stopTag` 레코드(표는 TABLE, 그리기 개체는 SHAPE_COMPONENT)보다
 * 앞에 있는 캡션 LIST_HEADER와 그 형제 문단을 읽는다. 캡션이 있으면 개체 공통 속성 bit 29가
 * 켜지고 캡션이 첫 자식이다(정정 81, 84). 코덱은 bit 29가 아니라 레코드 구조로 판단한다.
 */
function readLeadingCaption(
  node: RecordNode,
  stopTag: number,
  context: ParseContext,
): Caption | undefined {
  const [header, ...paragraphs] = leadingCaptionNodes(node, stopTag);
  if (!header) return undefined;
  const caption = readCaption(header);
  for (const p of paragraphs)
    caption.paragraphs.push(readParagraph(p, context));
  return caption;
}

/** {@link readLeadingCaption}이 읽는 자식: 캡션 LIST_HEADER와 그 뒤 문단. 캡션이 없으면 빈 배열. */
function leadingCaptionNodes(node: RecordNode, stopTag: number): RecordNode[] {
  const out: RecordNode[] = [];
  for (const child of node.children) {
    if (child.tagId === stopTag) break;
    if (child.tagId === SectionTag.ListHeader && !out.length) out.push(child);
    else if (child.tagId === SectionTag.ParaHeader && out.length)
      out.push(child);
  }
  return out;
}

function writeCaption(
  writer: RecordWriter,
  doc: HwpDocument,
  caption: Caption,
  objectWidth: number,
): void {
  const maxWidth = caption.maxWidth ?? objectWidth;
  let properties = (caption.unknownBits ?? 0) & ~0b111;
  properties = setBits(properties, 0, 1, caption.side);
  properties = setBit(properties, 2, caption.fullSize);
  const header = writeListHeader(
    new ByteWriter(),
    caption.paragraphs.length,
    // 세로 정렬이 없으면 한글이 만든 아래 캡션처럼 위(0)로 쓴다(table-caption-bottom.hwp).
    listPropertiesBits(caption, VerticalAlign.Top),
  )
    .uint32(properties >>> 0)
    .uint32(caption.width)
    .hwpUnit16(caption.gap)
    .uint32(maxWidth)
    .bytes(Uint8Array.from(caption.trailing ?? new Array(8).fill(0)));
  writer.write(SectionTag.ListHeader, header);
  caption.paragraphs.forEach((paragraph, index) => {
    writeParagraph(
      writer,
      doc,
      paragraph,
      undefined,
      index === caption.paragraphs.length - 1,
      maxWidth,
    );
  });
}

function idRefField(ref: number): { borderFillId?: number } {
  const id = fromIdRef(ref);
  return id === undefined ? {} : { borderFillId: id };
}

/**
 * 셀 LIST_HEADER 속성(표 65)의 셀 전용 비트 bit 16~20(HWPX `hp:tc`의 `hasMargin`, `protect`,
 * `header`, `editable`, `dirty`, `experiments/list-header-properties`). 공통 bit 0~6은
 * {@link readListHeader}가 읽고, 나머지는 `listUnknownBits`로 보존한다.
 */
const CELL_FLAGS = [
  [16, "hasMargin"],
  [17, "protect"],
  [18, "header"],
  [19, "editable"],
  [20, "dirty"],
] as const;
const CELL_FLAGS_MASK = 0b11111 << 16;

/** 공통 리스트 속성의 `listUnknownBits`에서 셀 전용 비트를 꺼내 셀 필드로 만든다. */
function readCellListProperties(
  list: Omit<ParagraphList, "paragraphs">,
): Partial<TableCell> {
  const { listUnknownBits = 0, ...rest } = list;
  const cell: Partial<TableCell> = rest;
  for (const [index, key] of CELL_FLAGS)
    if (bit(listUnknownBits, index)) cell[key] = true;
  const unknown = (listUnknownBits & ~CELL_FLAGS_MASK) >>> 0;
  if (unknown) cell.listUnknownBits = unknown;
  return cell;
}

/** {@link readCellListProperties}의 반대. 세로 정렬이 없으면 한글의 새 셀 기본값(가운데)을 쓴다. */
function cellListProperties(cell: TableCell): number {
  let properties = listPropertiesBits(cell, VerticalAlign.Center);
  for (const [index, key] of CELL_FLAGS)
    properties = setBit(properties, index, cell[key]);
  return properties;
}

/**
 * 셀 LIST_HEADER: 문단 리스트 헤더 8바이트 뒤에 셀 속성(표 80) 26바이트(열·행·병합·크기·여백·
 * 테두리)가 온다. 셀 문단은 이 레코드의 형제로 뒤따르므로 호출하는 쪽이 채운다.
 */
function readTableCell(node: RecordNode): TableCell {
  const { list, reader } = readListHeader(node.payload);

  const col = reader.optionalUint16();
  const row = reader.optionalUint16();
  // 병합 수는 파일 값 그대로 둔다(0도). 레코드가 짧아 없을 때만 1로 본다.
  const colSpan = reader.optionalUint16(1);
  const rowSpan = reader.optionalUint16(1);
  const width = reader.hwpUnit();
  const height = reader.hwpUnit();
  const margins = {
    left: reader.optionalUint16(),
    right: reader.optionalUint16(),
    top: reader.optionalUint16(),
    bottom: reader.optionalUint16(),
  };
  const borderFillRef = reader.optionalUint16();
  // 표 80 뒤의 바이트(명세에 없음)는 그대로 보존한다.
  const trailing = reader.rest().slice();

  return {
    col,
    row,
    colSpan,
    rowSpan,
    width,
    height,
    margins,
    ...idRefField(borderFillRef),
    ...readCellListProperties(list),
    trailing,
    paragraphs: [],
  };
}

function readDrawingObject(
  node: RecordNode,
  context: ParseContext,
): Control | undefined {
  const shapeNode = childWithTag(node, SectionTag.ShapeComponent);
  const reader = new ByteReader(node.payload);
  reader.uint32(); // ctrl id, already consumed by the caller's reader
  let placement = readObjectPlacement(reader);
  // 캡션은 SHAPE_COMPONENT보다 앞, CTRL_HEADER의 첫 자식이다(rect-caption-bottom.hwp).
  const caption = readLeadingCaption(node, SectionTag.ShapeComponent, context);
  if (caption) placement = { ...placement, caption };

  // CTRL_HEADER는 placement로, 캡션은 placement.caption으로, SHAPE_COMPONENT는 shapeComponent로
  // 쓰고 나머지 레코드는 그대로 보존한다.
  const captionNodes = new Set(
    leadingCaptionNodes(node, SectionTag.ShapeComponent),
  );
  const rest = node.children.filter((c) => !captionNodes.has(c));
  // SHAPE_COMPONENT가 캡션 바로 뒤에 있을 때만 모델로 읽는다. 쓸 때 그 자리에 다시 쓰기 때문이다.
  const shapeComponent =
    shapeNode && rest[0] === shapeNode
      ? readShapeComponent(shapeNode.payload)
      : undefined;
  if (!shapeComponent)
    return {
      type: "unknown",
      ctrlId: CtrlId.DrawingObject,
      placement,
      ...rawChildRecords(node, rest),
    };
  // 도형별 레코드는 SHAPE_COMPONENT의 마지막 자식이고 뒤에 다른 레코드가 없을 때만 모델로 읽는다.
  // 쓸 때 글상자·childRecords 뒤에 붙이므로 순서가 같아야 한다.
  const shapeChildren = shapeNode!.children;
  const last = shapeChildren[shapeChildren.length - 1];
  const kind = SHAPE_KINDS[shapeComponent.shapeId];
  const specific =
    kind &&
    rest.length === 1 &&
    last?.tagId === kind.tag &&
    last.children.length === 0
      ? kind.read(last.payload)
      : undefined;
  if (kind && specific) {
    const { shapeId: _, ...shape } = shapeComponent;
    const middle = shapeChildren.slice(0, -1);
    const textBox = readTextBox(middle, context);
    return {
      type: kind.type,
      placement,
      ...shape,
      ...(textBox ? { textBox } : rawChildRecords(node, middle)),
      ...specific,
    } as Control;
  }
  return {
    type: "unknown",
    ctrlId: CtrlId.DrawingObject,
    placement,
    shapeComponent,
    ...rawChildRecords(node, [...shapeChildren, ...rest.slice(1)]),
  };
}

/**
 * 글상자: LIST_HEADER(문단 리스트 헤더 8B, 여백 HWPUNIT16 ×4, 최대 폭 HWPUNIT, 나머지)와 그 형제
 * 문단(정정 91). 자식이 LIST_HEADER 하나와 문단뿐이고 헤더가 20B 이상일 때만 읽는다. 아니면 호출하는
 * 쪽이 원본을 보존한다.
 */
function readTextBox(
  children: RecordNode[],
  context: ParseContext,
): ShapeTextBox | undefined {
  const [header, ...paragraphs] = children;
  if (
    header?.tagId !== SectionTag.ListHeader ||
    header.payload.length < 20 ||
    paragraphs.some((p) => p.tagId !== SectionTag.ParaHeader)
  )
    return undefined;
  const { list, reader } = readListHeader(header.payload);
  return {
    ...list,
    margins: {
      left: reader.hwpUnit16(),
      right: reader.hwpUnit16(),
      top: reader.hwpUnit16(),
      bottom: reader.hwpUnit16(),
    },
    maxWidth: reader.uint32(),
    // 짧은 원본에 13B를 덧붙이지 않도록 빈 배열도 둔다.
    textBoxTrailing: reader.rest().slice(),
    paragraphs: paragraphs.map((p) => readParagraph(p, context)),
  };
}

function writeTextBox(
  writer: RecordWriter,
  doc: HwpDocument,
  textBox: ShapeTextBox,
): void {
  const { margins, maxWidth, paragraphs } = textBox;
  const header = writeListHeader(
    new ByteWriter(),
    paragraphs.length,
    // 한글이 새로 만든 글상자는 세로 정렬 가운데다(object-overlap-lock).
    listPropertiesBits(textBox, VerticalAlign.Center),
  )
    .hwpUnit16(margins.left)
    .hwpUnit16(margins.right)
    .hwpUnit16(margins.top)
    .hwpUnit16(margins.bottom)
    .uint32(maxWidth)
    .bytes(textBox.textBoxTrailing ?? new Uint8Array(13));
  writer.write(SectionTag.ListHeader, header);
  paragraphs.forEach((paragraph, index) =>
    writeParagraph(
      writer,
      doc,
      paragraph,
      undefined,
      index === paragraphs.length - 1,
      maxWidth,
    ),
  );
}

/** 모델로 읽는 도형: 개체 ID → 컨트롤 타입, 도형별 레코드 태그, 그 레코드를 읽는 함수. */
const SHAPE_KINDS: Record<
  string,
  {
    type: ModeledShape["type"];
    tag: number;
    read: (payload: Uint8Array) => object | undefined;
  }
> = {
  $rec: {
    type: "rectangle",
    tag: SectionTag.ShapeComponentRectangle,
    read: readShapeRectangle,
  },
  $lin: {
    type: "line",
    tag: SectionTag.ShapeComponentLine,
    read: readLineShape,
  },
  $ell: {
    type: "ellipse",
    tag: SectionTag.ShapeComponentEllipse,
    read: readEllipseShape,
  },
  $arc: { type: "arc", tag: SectionTag.ShapeComponentArc, read: readArcShape },
  $pol: {
    type: "polygon",
    tag: SectionTag.ShapeComponentPolygon,
    read: readPolygonShape,
  },
  $cur: {
    type: "curve",
    tag: SectionTag.ShapeComponentCurve,
    read: readCurveShape,
  },
  $pic: {
    type: "picture",
    tag: SectionTag.ShapeComponentPicture,
    read: readPictureShape,
  },
};

/** 모델로 읽고 쓰는 도형 컨트롤. */
type ModeledShape =
  | RectangleControl
  | LineControl
  | EllipseControl
  | ArcControl
  | PolygonControl
  | CurveControl
  | PictureControl;

const readPoint = (r: ByteReader): Point => ({ x: r.int32(), y: r.int32() });
const writePoint = (w: ByteWriter, p: Point): ByteWriter =>
  w.int32(p.x).int32(p.y);

/** 도형별 필드: 컨트롤에서 ShapeBase와 type을 뺀 것. */
type Specific<T extends ModeledShape> = Omit<T, keyof ShapeBase | "type">;

/** 타원 속성(표 97)에서 아는 비트: bit 1 호로 바뀌었는지, bit 8~15 호 종류(정정 99). */
const ELLIPSE_KNOWN = 0xff02;

/**
 * 타원 개체 속성(표 96, 60바이트): 속성 UINT32, 중심·제1축·제2축, start1·end1·start2·end2 (x, y)
 * INT32 쌍. 배치는 명세와 같고(E45), 속성의 호 종류만 bit 8~15다(정정 99). 60바이트보다 짧으면 읽지 않는다.
 */
export function readEllipseShape(
  payload: Uint8Array,
): Specific<EllipseControl> | undefined {
  if (payload.length < 60) return undefined;
  const r = new ByteReader(payload);
  const attributes = r.uint32();
  const ellipse: Specific<EllipseControl> = {
    center: readPoint(r),
    axis1: readPoint(r),
    axis2: readPoint(r),
    start1: readPoint(r),
    end1: readPoint(r),
    start2: readPoint(r),
    end2: readPoint(r),
  };
  if (bit(attributes, 1)) ellipse.hasArcProperty = true;
  if (bits(attributes, 8, 15)) ellipse.arcKind = bits(attributes, 8, 15);
  const unknown = (attributes & ~ELLIPSE_KNOWN) >>> 0;
  if (unknown) ellipse.ellipseUnknownBits = unknown;
  if (r.hasMore()) ellipse.ellipseTrailing = r.rest().slice();
  return ellipse;
}

export function writeEllipseShape(e: Specific<EllipseControl>): ByteWriter {
  let attributes = (e.ellipseUnknownBits ?? 0) & ~ELLIPSE_KNOWN;
  attributes = setBit(attributes, 1, e.hasArcProperty);
  attributes = setBits(
    attributes,
    8,
    15,
    checkBitField(e.arcKind ?? 0, 8, "arcKind"),
  );
  const w = new ByteWriter().uint32(attributes >>> 0);
  for (const p of [
    e.center,
    e.axis1,
    e.axis2,
    e.start1,
    e.end1,
    e.start2,
    e.end2,
  ])
    writePoint(w, p);
  if (e.ellipseTrailing) w.bytes(e.ellipseTrailing);
  return w;
}

/**
 * 호 개체 속성(표 101): 호 종류 BYTE, 중심·제1축·제2축 (x, y) INT32 쌍. 명세는 속성 UINT32에 28바이트지만
 * 한글은 25바이트를 쓴다(정정 96). 25바이트보다 짧으면 읽지 않는다.
 */
export function readArcShape(
  payload: Uint8Array,
): Specific<ArcControl> | undefined {
  if (payload.length < 25) return undefined;
  const r = new ByteReader(payload);
  const arc: Specific<ArcControl> = {
    arcKind: r.uint8(),
    center: readPoint(r),
    axis1: readPoint(r),
    axis2: readPoint(r),
  };
  if (r.hasMore()) arc.arcTrailing = r.rest().slice();
  return arc;
}

export function writeArcShape(a: Specific<ArcControl>): ByteWriter {
  const w = new ByteWriter().uint8(a.arcKind);
  for (const p of [a.center, a.axis1, a.axis2]) writePoint(w, p);
  if (a.arcTrailing) w.bytes(a.arcTrailing);
  return w;
}

/**
 * 점 수 UINT32와 (x, y) INT32 쌍들. 다각형·곡선 레코드의 앞부분이다. 명세는 점 수 INT16, x 배열 다음
 * y 배열이지만 한글은 이렇게 쓴다(정정 97, 98). 점이 레코드보다 많으면 읽지 않는다.
 */
function readPointList(
  r: ByteReader,
  payload: Uint8Array,
): Point[] | undefined {
  if (payload.length < 4) return undefined;
  const count = r.uint32();
  if (count > (payload.length - 4) / 8) return undefined;
  return Array.from({ length: count }, () => readPoint(r));
}

function writePointList(w: ByteWriter, points: Point[]): ByteWriter {
  w.uint32(points.length);
  for (const p of points) writePoint(w, p);
  return w;
}

/** 다각형 개체 속성(표 99, 정정 97). 짧은 원본에 덧붙이지 않도록 끝 바이트는 비어 있어도 둔다. */
export function readPolygonShape(
  payload: Uint8Array,
): Specific<PolygonControl> | undefined {
  const r = new ByteReader(payload);
  const points = readPointList(r, payload);
  return points && { points, polygonTrailing: r.rest().slice() };
}

export function writePolygonShape(p: Specific<PolygonControl>): ByteWriter {
  return writePointList(new ByteWriter(), p.points).bytes(
    p.polygonTrailing ?? new Uint8Array(4),
  );
}

/**
 * 곡선 개체 속성(표 103, 정정 98): 점 목록, 구간 종류 BYTE (점 수 − 1)개, 나머지. 점이 없거나 구간 종류가
 * 레코드보다 길면 읽지 않는다.
 */
export function readCurveShape(
  payload: Uint8Array,
): Specific<CurveControl> | undefined {
  const r = new ByteReader(payload);
  const points = readPointList(r, payload);
  if (!points?.length || (points.length > 1 && !r.hasMore(points.length - 1)))
    return undefined;
  const segmentTypes = Array.from({ length: points.length - 1 }, () =>
    r.uint8(),
  );
  return { points, segmentTypes, curveTrailing: r.rest().slice() };
}

export function writeCurveShape(c: Specific<CurveControl>): ByteWriter {
  if (c.segmentTypes.length !== c.points.length - 1)
    throw new RangeError(
      `곡선 구간 종류는 점 수 − 1개여야 한다: 점 ${c.points.length}개, 구간 ${c.segmentTypes.length}개`,
    );
  const w = writePointList(new ByteWriter(), c.points);
  for (const t of c.segmentTypes) w.uint8(t);
  return w.bytes(c.curveTrailing ?? new Uint8Array(4));
}

/** SHAPE_COMPONENT_LINE(표 92)이 담는 {@link LineControl} 필드. */
type LineShape = Pick<
  LineControl,
  "start" | "end" | "reverseHV" | "lineUnknownBits" | "lineTrailing"
>;

/**
 * 선 개체 속성(표 92): 시작점·끝점 INT32 ×4, 속성 UINT16(bit 0 `reverseHV`). 한글은 그 뒤에 0 2바이트를
 * 더 써 20바이트다(정정 95). 18바이트보다 짧으면 읽지 않는다. 짧은 원본에 덧붙이지 않도록 끝 바이트는
 * 비어 있어도 둔다.
 */
export function readLineShape(payload: Uint8Array): LineShape | undefined {
  if (payload.length < 18) return undefined;
  const r = new ByteReader(payload);
  const start = { x: r.int32(), y: r.int32() };
  const end = { x: r.int32(), y: r.int32() };
  const attributes = r.uint16();
  const line: LineShape = { start, end, lineTrailing: r.rest().slice() };
  if (attributes & 1) line.reverseHV = true;
  if (attributes & ~1) line.lineUnknownBits = attributes & ~1;
  return line;
}

export function writeLineShape(line: LineShape): ByteWriter {
  const unknown = checkBitField(
    line.lineUnknownBits ?? 0,
    16,
    "lineUnknownBits",
  );
  return new ByteWriter()
    .int32(line.start.x)
    .int32(line.start.y)
    .int32(line.end.x)
    .int32(line.end.y)
    .uint16((unknown & ~1) | (line.reverseHV ? 1 : 0))
    .bytes(line.lineTrailing ?? new Uint8Array(2));
}

/** SHAPE_COMPONENT_RECTANGLE(표 94)이 담는 {@link RectangleControl} 필드. */
type ShapeRectangle = Pick<
  RectangleControl,
  "cornerCurvature" | "points" | "rectangleTrailing"
>;

/** 사각형 개체 속성(표 94): 곡률 BYTE, (x, y) INT32 쌍 4개(정정 93). 33바이트보다 짧으면 읽지 않는다. */
export function readShapeRectangle(
  payload: Uint8Array,
): ShapeRectangle | undefined {
  if (payload.length < 33) return undefined;
  const r = new ByteReader(payload);
  const cornerCurvature = r.uint8();
  const point = () => ({ x: r.int32(), y: r.int32() });
  const rectangle: ShapeRectangle = {
    cornerCurvature,
    points: [point(), point(), point(), point()],
  };
  if (r.hasMore()) rectangle.rectangleTrailing = r.rest();
  return rectangle;
}

export function writeShapeRectangle(rectangle: ShapeRectangle): ByteWriter {
  if (rectangle.points.length !== 4)
    throw new RangeError(
      `사각형 꼭짓점은 4개여야 한다: ${rectangle.points.length}개`,
    );
  const w = new ByteWriter().uint8(rectangle.cornerCurvature);
  for (const p of rectangle.points) w.int32(p.x).int32(p.y);
  if (rectangle.rectangleTrailing) w.bytes(rectangle.rectangleTrailing);
  return w;
}

/** SHAPE_COMPONENT_PICTURE(표 107, 116)이 담는 {@link PictureControl} 필드. */
type ShapePicture = Specific<PictureControl>;

/** 그림 효과 플래그(표 108)에서 아는 비트: 그림자, 네온, 옅은 테두리, 반사(E53). */
const PICTURE_EFFECTS_KNOWN = 0b1111;

/**
 * 그림 개체 속성(표 107, 116). 효과 앞 78바이트: 테두리 12B(표 86에서 Outline style을 뺀 것), 꼭짓점
 * (x, y) INT32 쌍 4개(정정 102), 자른 뒤 사각형 left·top·right·bottom, 그림 여백 HWPUNIT16 왼쪽·오른쪽·
 * 위·아래, 그림 정보 5B(명암, 밝기, 효과, BinItem ID. 정정 11), 테두리 투명도 BYTE, 인스턴스 ID. 그 뒤에
 * 그림 효과(표 108)와 원본 크기 HWPUNIT ×2, 그림 투명도 BYTE(표 116)가 온다. 78바이트보다 짧으면
 * 읽지 않는다. 효과를 모델로 읽지 못하면 그 뒤를 `pictureTrailing`에 원본 그대로 둔다.
 */
export function readPictureShape(
  payload: Uint8Array,
): ShapePicture | undefined {
  if (payload.length < 78) return undefined;
  const r = new ByteReader(payload);
  const border = readLineBody(r);
  const points: ShapePicture["points"] = [
    readPoint(r),
    readPoint(r),
    readPoint(r),
    readPoint(r),
  ];
  const crop = {
    left: r.int32(),
    top: r.int32(),
    right: r.int32(),
    bottom: r.int32(),
  };
  const innerMargins = {
    left: r.hwpUnit16(),
    right: r.hwpUnit16(),
    top: r.hwpUnit16(),
    bottom: r.hwpUnit16(),
  };
  const picture: ShapePicture = {
    border,
    borderTransparency: 0,
    points,
    crop,
    innerMargins,
    contrast: r.int8(),
    brightness: r.int8(),
    effect: r.uint8(),
    binDataId: r.uint16() - 1,
    pictureInstanceId: 0,
  };
  picture.borderTransparency = r.uint8();
  picture.pictureInstanceId = r.uint32();
  const effects = readPictureEffects(r, payload);
  if (effects) {
    picture.effects = effects;
    if (r.hasMore(8))
      picture.originalSize = { width: r.uint32(), height: r.uint32() };
    if (picture.originalSize && r.hasMore()) picture.transparency = r.uint8();
  }
  if (r.hasMore()) picture.pictureTrailing = r.rest();
  return picture;
}

/**
 * 그림 효과(표 108~114). 다시 써서 원본과 같은 바이트가 될 때만 돌려준다. 모르는 플래그 비트나 RGB가
 * 아닌 색 타입처럼 길이를 알 수 없으면 커서를 되돌리고 `undefined`를 돌려준다.
 */
function readPictureEffects(
  r: ByteReader,
  payload: Uint8Array,
): PictureEffects | undefined {
  const start = r.offset;
  try {
    const flags = r.uint32();
    if ((flags & ~PICTURE_EFFECTS_KNOWN) === 0) {
      const effects: PictureEffects = {};
      if (bit(flags, 0))
        effects.shadow = {
          style: r.int32(),
          transparency: r.float32(),
          blur: r.float32(),
          direction: r.float32(),
          distance: r.float32(),
          align: r.int32(),
          skewX: r.float32(),
          skewY: r.float32(),
          scaleX: r.float32(),
          scaleY: r.float32(),
          rotateWithShape: r.int32(),
          color: readEffectColor(r),
        };
      if (bit(flags, 1))
        effects.glow = {
          transparency: r.float32(),
          radius: r.float32(),
          color: readEffectColor(r),
        };
      if (bit(flags, 2)) effects.softEdge = r.float32();
      if (bit(flags, 3))
        effects.reflection = {
          align: r.int32(),
          radius: r.float32(),
          direction: r.float32(),
          distance: r.float32(),
          skewX: r.float32(),
          skewY: r.float32(),
          scaleX: r.float32(),
          scaleY: r.float32(),
          rotateWithShape: r.int32(),
          startTransparency: r.float32(),
          startPosition: r.float32(),
          endTransparency: r.float32(),
          endPosition: r.float32(),
          fadeDirection: r.float32(),
        };
      const original = payload.subarray(start, r.offset);
      const written = writePictureEffects(new ByteWriter(), effects).finish();
      if (
        written.length === original.length &&
        written.every((b, i) => b === original[i])
      )
        return effects;
    }
  } catch (error) {
    // 짧은 레코드, 모르는 색 타입, NaN 같은 값도 원본 그대로 보존한다.
    if (!(error instanceof RangeError || error instanceof HwpFormatError))
      throw error;
  }
  r.offset = start;
  return undefined;
}

/** 색 속성(표 113): 색상 타입 INT32, 타입이 0(RGB)이면 0x00rrggbb, 색상 효과 수, (종류 INT32, 값 float) 쌍. */
function readEffectColor(r: ByteReader): PictureEffectColor {
  if (r.int32() !== 0)
    throw new RangeError("RGB가 아닌 그림 효과 색 타입은 읽지 않는다.");
  const [b, g, red, unknown] = [r.uint8(), r.uint8(), r.uint8(), r.uint8()];
  const count = r.uint32();
  if (!r.hasMore(8 * count))
    throw new RangeError(`색상 효과 ${count}개가 레코드보다 길다.`);
  const effects: PictureEffectColor["effects"] = [];
  for (let i = 0; i < count; i++)
    effects.push({ kind: r.int32(), value: r.float32() });
  return { rgb: { r: red, g, b, unknown }, effects };
}

function writeEffectColor(w: ByteWriter, color: PictureEffectColor): void {
  const { r, g, b, unknown } = color.rgb;
  w.int32(0).uint8(b).uint8(g).uint8(r).uint8(unknown);
  w.uint32(color.effects.length);
  for (const e of color.effects) w.int32(e.kind).float32(e.value);
}

function writePictureEffects(
  w: ByteWriter,
  effects: PictureEffects,
): ByteWriter {
  const { shadow, glow, softEdge, reflection } = effects;
  let flags = 0;
  flags = setBit(flags, 0, shadow !== undefined);
  flags = setBit(flags, 1, glow !== undefined);
  flags = setBit(flags, 2, softEdge !== undefined);
  flags = setBit(flags, 3, reflection !== undefined);
  w.uint32(flags);
  if (shadow) {
    w.int32(shadow.style)
      .float32(shadow.transparency)
      .float32(shadow.blur)
      .float32(shadow.direction)
      .float32(shadow.distance)
      .int32(shadow.align)
      .float32(shadow.skewX)
      .float32(shadow.skewY)
      .float32(shadow.scaleX)
      .float32(shadow.scaleY)
      .int32(shadow.rotateWithShape);
    writeEffectColor(w, shadow.color);
  }
  if (glow) {
    w.float32(glow.transparency).float32(glow.radius);
    writeEffectColor(w, glow.color);
  }
  if (softEdge !== undefined) w.float32(softEdge);
  if (reflection)
    w.int32(reflection.align)
      .float32(reflection.radius)
      .float32(reflection.direction)
      .float32(reflection.distance)
      .float32(reflection.skewX)
      .float32(reflection.skewY)
      .float32(reflection.scaleX)
      .float32(reflection.scaleY)
      .int32(reflection.rotateWithShape)
      .float32(reflection.startTransparency)
      .float32(reflection.startPosition)
      .float32(reflection.endTransparency)
      .float32(reflection.endPosition)
      .float32(reflection.fadeDirection);
  return w;
}

export function writePictureShape(picture: ShapePicture): ByteWriter {
  if (picture.points.length !== 4)
    throw new RangeError(
      `그림 꼭짓점은 4개여야 한다: ${picture.points.length}개`,
    );
  const { crop, innerMargins: m } = picture;
  const w = writeLineBody(new ByteWriter(), picture.border);
  for (const p of picture.points) writePoint(w, p);
  w.int32(crop.left).int32(crop.top).int32(crop.right).int32(crop.bottom);
  w.hwpUnit16(m.left).hwpUnit16(m.right).hwpUnit16(m.top).hwpUnit16(m.bottom);
  w.int8(picture.contrast)
    .int8(picture.brightness)
    .uint8(picture.effect)
    .uint16(picture.binDataId + 1)
    .uint8(picture.borderTransparency)
    .uint32(picture.pictureInstanceId);
  if (picture.effects) writePictureEffects(w, picture.effects);
  if (picture.originalSize)
    w.uint32(picture.originalSize.width).uint32(picture.originalSize.height);
  if (picture.transparency !== undefined) w.uint8(picture.transparency);
  if (picture.pictureTrailing) w.bytes(picture.pictureTrailing);
  return w;
}

/** 개체 요소 속성(표 83) bit 0 수평 반전, bit 1 수직 반전. */
const SHAPE_COMPONENT_KNOWN = 0b11;

/**
 * 문단에 놓인 개체의 SHAPE_COMPONENT(표 82~85): 개체 컨트롤 ID 두 번, 개체 요소 속성 42바이트,
 * Rendering 정보(행렬 쌍 수 WORD, translation matrix, scale/rotation matrix 쌍). 그 뒤 바이트는
 * `trailing`으로 둔다. ID가 두 번 오지 않거나, 레코드가 행렬보다 짧거나, 유한하지 않은 행렬
 * 원소가 있으면 해석하지 않는다(`undefined`). 호출하는 쪽이 레코드를 원본 그대로 보존한다.
 */
export function readShapeComponent(
  payload: Uint8Array,
): ShapeComponent | undefined {
  const r = new ByteReader(payload);
  if (!r.hasMore(8 + 42 + 2)) return undefined;
  const id = r.uint32();
  if (r.uint32() !== id) return undefined;
  const groupOffsetX = r.int32();
  const groupOffsetY = r.int32();
  const groupLevel = r.uint16();
  const localVersion = r.uint16();
  const initialWidth = r.uint32();
  const initialHeight = r.uint32();
  const width = r.uint32();
  const height = r.uint32();
  const properties = r.uint32();
  const rotation = r.hwpUnit16();
  const rotationCenter = { x: r.int32(), y: r.int32() };
  const count = r.uint16();
  if (!r.hasMore(48 * (1 + count * 2))) return undefined;
  const matrix = (): ShapeMatrix => [
    r.float64(),
    r.float64(),
    r.float64(),
    r.float64(),
    r.float64(),
    r.float64(),
  ];
  const translation = matrix();
  const scaleRotations: ShapeComponent["scaleRotations"] = [];
  for (let i = 0; i < count; i++)
    scaleRotations.push({ scale: matrix(), rotation: matrix() });
  const matrices = [
    translation,
    ...scaleRotations.flatMap((p) => [p.scale, p.rotation]),
  ];
  // NaN·무한대는 다시 쓸 때 같은 비트를 보장하지 못한다.
  if (!matrices.every((m) => m.every(Number.isFinite))) return undefined;

  const shape: ShapeComponent = {
    shapeId: readCtrlId(id),
    groupOffsetX,
    groupOffsetY,
    groupLevel,
    localVersion,
    initialWidth,
    initialHeight,
    width,
    height,
    rotation,
    rotationCenter,
    translation,
    scaleRotations,
  };
  if (bit(properties, 0)) shape.flipHorizontal = true;
  if (bit(properties, 1)) shape.flipVertical = true;
  const unknownBits = (properties & ~SHAPE_COMPONENT_KNOWN) >>> 0;
  if (unknownBits) shape.unknownBits = unknownBits;
  // 테두리 선 정보는 그리기 개체에만 있다. 짧으면 해석하지 않고 trailing에 남긴다.
  if (DRAWING_SHAPE_IDS.has(shape.shapeId) && r.hasMore(SHAPE_LINE_SIZE)) {
    shape.line = readShapeLine(r);
    const fill = readShapeFill(r, payload);
    if (fill) shape.fill = fill;
    // 채우기를 읽었을 때만 그 뒤가 그림자임을 안다.
    if (fill && r.hasMore(SHAPE_SHADOW_SIZE)) {
      shape.shadow = {
        kind: r.uint32(),
        color: r.color(),
        offsetX: r.int32(),
        offsetY: r.int32(),
        transparency: 0,
      };
      shape.instanceId = r.uint32();
      const afterInstanceId = r.uint8();
      if (afterInstanceId) shape.afterInstanceId = afterInstanceId;
      shape.shadow.transparency = r.uint8();
    }
  }
  if (r.hasMore()) shape.trailing = r.rest();
  return shape;
}

/** 테두리 선 정보(표 81)를 가진 그리기 개체(4.3.9.2): 선, 사각형, 타원, 호, 다각형, 곡선. */
const DRAWING_SHAPE_IDS = new Set([
  "$lin",
  "$rec",
  "$ell",
  "$arc",
  "$pol",
  "$cur",
]);

/** 테두리 선 정보의 길이. 명세는 11이지만 선 굵기가 4바이트라 13이다(정정 89). */
const SHAPE_LINE_SIZE = 13;

/**
 * 채우기 뒤의 그림자와 인스턴스 ID(정정 91): 그림자 종류 UINT32, 색 COLORREF, 가로·세로 이동 INT32,
 * 인스턴스 ID UINT32, 뜻 모를 BYTE, 그림자 투명도 BYTE.
 */
const SHAPE_SHADOW_SIZE = 22;

/**
 * 테두리 선 정보(표 86): 색 COLORREF, 굵기 INT32, 속성 UINT32(표 87), Outline style BYTE(표 88).
 * 속성의 32비트는 모두 명세가 정의한다.
 */
function readShapeLine(r: ByteReader): ShapeLine {
  return { ...readLineBody(r), outlineStyle: r.uint8() };
}

/** 테두리 선 정보에서 Outline style 앞 12바이트. 그림 테두리(표 107)도 이 배치다. */
function readLineBody(r: ByteReader): PictureBorder {
  const color = r.color();
  const width = r.int32();
  const properties = r.uint32();
  return {
    color,
    width,
    style: bits(properties, 0, 5),
    endCap: bits(properties, 6, 9),
    startArrow: bits(properties, 10, 15),
    endArrow: bits(properties, 16, 21),
    startArrowSize: bits(properties, 22, 25),
    endArrowSize: bits(properties, 26, 29),
    startArrowFill: bit(properties, 30),
    endArrowFill: bit(properties, 31),
  };
}

/**
 * 테두리 선 뒤의 채우기 정보(표 28). DocInfo 테두리/배경의 {@link readFill}로 읽는다. 그 리더는
 * 여러 종류가 켜진 채우기에서 하나만 남기고 추가 채우기 속성의 모르는 바이트를 건너뛰므로, 읽은
 * 값을 다시 써서 원본과 같을 때만 쓴다. 다르면 커서를 되돌리고 `undefined`를 돌려줘, 그 바이트가
 * `trailing`에 원본 그대로 남게 한다.
 */
function readShapeFill(r: ByteReader, payload: Uint8Array): Fill | undefined {
  if (!r.hasMore(4)) return undefined;
  const start = r.offset;
  try {
    const fill = readFill(r);
    const original = payload.subarray(start, r.offset);
    const written = new ByteWriter();
    writeFill(written, fill);
    const bytes = written.finish();
    if (
      bytes.length === original.length &&
      bytes.every((b, i) => b === original[i])
    )
      return fill;
  } catch (error) {
    // 짧은 레코드나 라이터가 거부하는 값도 원본 그대로 보존한다.
    if (!(error instanceof RangeError || error instanceof HwpFormatError))
      throw error;
  }
  r.offset = start;
  return undefined;
}

/** `value`가 `width`비트 필드에 담기는지 검사한다. `setBits`는 넘치는 비트를 조용히 버린다. */
function checkBitField(value: number, width: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value >= 2 ** width)
    throw new RangeError(
      `${name} ${value}는 ${width}비트(0~${2 ** width - 1})에 담을 수 없다.`,
    );
  return value;
}

function writeShapeLine(w: ByteWriter, line: ShapeLine): void {
  writeLineBody(w, line).uint8(line.outlineStyle);
}

function writeLineBody(w: ByteWriter, line: PictureBorder): ByteWriter {
  let properties = 0;
  properties = setBits(
    properties,
    0,
    5,
    checkBitField(line.style, 6, "선 종류"),
  );
  properties = setBits(
    properties,
    6,
    9,
    checkBitField(line.endCap, 4, "선 끝 모양"),
  );
  properties = setBits(
    properties,
    10,
    15,
    checkBitField(line.startArrow, 6, "화살표 시작 모양"),
  );
  properties = setBits(
    properties,
    16,
    21,
    checkBitField(line.endArrow, 6, "화살표 끝 모양"),
  );
  properties = setBits(
    properties,
    22,
    25,
    checkBitField(line.startArrowSize, 4, "화살표 시작 크기"),
  );
  properties = setBits(
    properties,
    26,
    29,
    checkBitField(line.endArrowSize, 4, "화살표 끝 크기"),
  );
  properties = setBit(properties, 30, line.startArrowFill);
  properties = setBit(properties, 31, line.endArrowFill);
  return w
    .color(line.color)
    .int32(line.width)
    .uint32(properties >>> 0);
}

/** {@link readShapeComponent}의 역. 개체 컨트롤 ID를 두 번 쓰고 행렬 쌍 수는 배열 길이로 쓴다. */
export function writeShapeComponent(shape: ShapeComponent): ByteWriter {
  if (!/^[\x20-\x7e]{4}$/.test(shape.shapeId))
    throw new RangeError(
      `개체 컨트롤 ID는 ASCII 네 글자여야 한다: ${JSON.stringify(shape.shapeId)}`,
    );
  const id = writeCtrlId(shape.shapeId);
  let properties = (shape.unknownBits ?? 0) & ~SHAPE_COMPONENT_KNOWN;
  properties = setBit(properties, 0, shape.flipHorizontal);
  properties = setBit(properties, 1, shape.flipVertical);
  const w = new ByteWriter()
    .uint32(id)
    .uint32(id)
    .int32(shape.groupOffsetX)
    .int32(shape.groupOffsetY)
    .uint16(shape.groupLevel)
    .uint16(shape.localVersion)
    .uint32(shape.initialWidth)
    .uint32(shape.initialHeight)
    .uint32(shape.width)
    .uint32(shape.height)
    .uint32(properties >>> 0)
    .hwpUnit16(shape.rotation)
    .int32(shape.rotationCenter.x)
    .int32(shape.rotationCenter.y)
    .uint16(shape.scaleRotations.length);
  const matrix = (m: ShapeMatrix): void => {
    if (m.length !== 6)
      throw new RangeError(`행렬 원소는 6개여야 한다: ${m.length}개`);
    m.forEach((v) => w.float64(v));
  };
  matrix(shape.translation);
  for (const { scale, rotation } of shape.scaleRotations) {
    matrix(scale);
    matrix(rotation);
  }
  if (shape.line) writeShapeLine(w, shape.line);
  if (shape.fill) writeFill(w, shape.fill);
  if (shape.shadow || shape.instanceId !== undefined) {
    const { shadow, instanceId } = shape;
    if (!shadow || instanceId === undefined)
      throw new RangeError("그림자와 인스턴스 ID는 함께 있어야 한다.");
    if (!shape.fill) throw new RangeError("그림자는 채우기 뒤에만 쓸 수 있다.");
    w.uint32(shadow.kind)
      .color(shadow.color)
      .int32(shadow.offsetX)
      .int32(shadow.offsetY)
      .uint32(instanceId)
      .uint8(shape.afterInstanceId ?? 0)
      .uint8(shadow.transparency);
  }
  if (shape.trailing) w.bytes(shape.trailing);
  return w;
}

/**
 * 개체 공통 속성에서 뜻을 모르는 비트: bit 1(예약), bit 31.
 * bit 29는 캡션 유무다(정정 81). 켜져 있는데 캡션 LIST_HEADER가 없으면 한글이 파일을
 * 손상됐다고 거부하므로, 값을 보존하지 않고 캡션을 실제로 쓸 때만 켠다.
 */
const OBJECT_UNKNOWN_BITS = ((1 << 1) | (1 << 31)) >>> 0;

function readObjectPlacement(reader: ByteReader): ObjectPlacement {
  const properties = reader.optionalUint32();
  const offsetY = reader.optionalInt32();
  const offsetX = reader.optionalInt32();
  const width = reader.optionalUint32();
  const height = reader.optionalUint32();
  const zOrder = reader.optionalInt32();
  // 바깥 여백은 왼쪽, 오른쪽, 위쪽, 아래쪽 순서다(명세에는 순서가 없다. 정정 75).
  const marginLeft = reader.optionalInt16();
  const marginRight = reader.optionalInt16();
  const marginTop = reader.optionalInt16();
  const marginBottom = reader.optionalInt16();
  const instanceId = reader.optionalUint32();
  const keepWithAnchor = reader.hasMore(4) ? reader.int32() !== 0 : undefined;
  // 설명문 길이 필드가 없는 옛 형식(44B)은 trailing을 null로 둬서 그대로 다시 쓴다.
  let description: string | undefined;
  let trailing: number[] | null = null;
  if (reader.hasMore(2)) {
    description = reader.string();
    // 한글 2024는 설명문 뒤에 명세에 없는 2바이트를 더 쓴다(정정 76).
    trailing = Array.from(reader.rest());
  }

  return {
    treatAsChar: bit(properties, 0),
    affectLineSpacing: bit(properties, 2),
    vertRelTo:
      bits(properties, 3, 4) === 2
        ? RelativeTo.Paragraph
        : bits(properties, 3, 4),
    vertAlign: bits(properties, 5, 7),
    horzRelTo: bits(properties, 8, 9),
    horzAlign: bits(properties, 10, 12),
    flowWithText: bit(properties, 13),
    allowOverlap: bit(properties, 14),
    fixedSize: bit(properties, 20),
    textWrap: bits(properties, 21, 23),
    textFlowSide: bits(properties, 24, 25),
    numberingKind: bits(properties, 26, 28),
    locked: bit(properties, 30),
    unknownBits: (properties & OBJECT_UNKNOWN_BITS) >>> 0,
    keepWithAnchor,
    description,
    trailing,
    offsetX,
    offsetY,
    width,
    height,
    widthCriterion: bits(properties, 15, 17),
    heightCriterion: bits(properties, 18, 19),
    zOrder,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    instanceId,
  };
}

/** 글자 모양 맵을 써서 위치가 정해진 항목들을 run으로 묶는다. */
/** 글자 모양 맵에서 `position` 글자에 적용되는 글자 모양. */
function charShapeAt(
  charShapes: { position: number; charShapeId: number }[],
  position: number,
): number {
  let current = charShapes[0]?.charShapeId ?? 0;
  for (const entry of charShapes) {
    if (entry.position > position) break;
    current = entry.charShapeId;
  }
  return current;
}

function buildRuns(
  items: PositionedItem[],
  charShapes: { position: number; charShapeId: number }[],
): Run[] {
  const shapeAt = (position: number): number =>
    charShapeAt(charShapes, position);

  const runs: Run[] = [];
  for (const { position, item } of items) {
    // 텍스트 항목이 모양 경계를 걸칠 수 있으므로 맵이 말하는 자리에서 쪼갠다.
    if (item.type === "text") {
      let offset = 0;
      while (offset < item.value.length) {
        const start = position + offset;
        const shapeId = shapeAt(start);
        const next = charShapes.find((entry) => entry.position > start);
        const end =
          next && next.position < position + item.value.length
            ? next.position - position
            : item.value.length;
        append(runs, shapeId, {
          type: "text",
          value: item.value.slice(offset, end),
        });
        offset = end;
      }
      continue;
    }
    append(runs, shapeAt(position), item);
  }
  return runs;
}

function append(runs: Run[], charShapeId: number, item: InlineItem): void {
  if (item.type === "text" && item.value === "") return;
  const last = runs[runs.length - 1];
  if (last && last.charShapeId === charShapeId) {
    const lastItem = last.items[last.items.length - 1];
    if (lastItem?.type === "text" && item.type === "text") {
      lastItem.value += item.value;
      return;
    }
    last.items.push(item);
    return;
  }
  runs.push({ charShapeId, items: [item] });
}

// ---------------------------------------------------------------------------
// 쓰기
// ---------------------------------------------------------------------------

/** 구역을 `BodyText/Section{N}` 스트림으로 직렬화한다. */
export function serializeSection(
  doc: HwpDocument,
  section: Section,
  isFirst: boolean,
): Uint8Array {
  const writer = new RecordWriter();
  section.paragraphs.forEach((paragraph, index) => {
    const last = index === section.paragraphs.length - 1;
    writeParagraph(
      writer,
      doc,
      paragraph,
      index === 0 && isFirst ? section : undefined,
      last,
      undefined,
      last ? section.memos : undefined,
    );
  });
  return writer.finish();
}

interface EncodedText {
  /** 컨트롤을 포함한 문단 텍스트의 UTF-16 코드 단위. */
  codes: number[];
  /** 글자 모양 맵 항목. */
  charShapes: { position: number; charShapeId: number }[];
  /** `CTRL_HEADER`가 필요한 컨트롤. 나타나는 순서대로. */
  extended: { control: Control }[];
  controlMask: number;
}

function encodeParagraphText(
  paragraph: Paragraph,
  sectionForDefinition?: Section,
): EncodedText {
  const codes: number[] = [];
  const charShapes: { position: number; charShapeId: number }[] = [];
  const extended: { control: Control }[] = [];
  let controlMask = 0;
  let lastShapeId = -1;

  const mark = (code: number): void => {
    // 1 << 31은 음수라 부호 없는 값으로 되돌린다.
    controlMask = (controlMask | (1 << code)) >>> 0;
  };

  const pushExtended = (code: number, control: Control): void => {
    mark(code);
    extended.push({ control });
    const id = writeCtrlId(ctrlIdFor(control));
    const data =
      control.type === "fieldBegin" && control.textData
        ? control.textData
        : [id & 0xffff, id >>> 16];
    codes.push(code);
    for (let i = 0; i < 6; i++) codes.push(data[i] ?? 0);
    codes.push(code);
  };

  const pushInline = (code: number, payload: number[] = []): void => {
    mark(code);
    codes.push(code);
    for (let i = 0; i < 6; i++) codes.push(payload[i] ?? 0);
    codes.push(code);
  };

  // 구역 정의는 맨 앞에 컨트롤 0x02로 내보낸다.
  if (sectionForDefinition) {
    mark(0x02);
    extended.push({
      control: { type: "unknown", ctrlId: CtrlId.SectionDefinition },
    });
    const id = writeCtrlId(CtrlId.SectionDefinition);
    codes.push(0x02, id & 0xffff, id >>> 16, 0, 0, 0, 0, 0x02);
    extended.push({
      control: { type: "unknown", ctrlId: CtrlId.ColumnDefinition },
    });
    const columnId = writeCtrlId(CtrlId.ColumnDefinition);
    codes.push(0x02, columnId & 0xffff, columnId >>> 16, 0, 0, 0, 0, 0x02);
    const firstCharShapeId =
      paragraph.sectionControlCharShapeId ??
      paragraph.runs[0]?.charShapeId ??
      0;
    charShapes.push({ position: 0, charShapeId: firstCharShapeId });
    lastShapeId = firstCharShapeId;
  }

  for (const run of paragraph.runs) {
    if (run.charShapeId !== lastShapeId) {
      charShapes.push({ position: codes.length, charShapeId: run.charShapeId });
      lastShapeId = run.charShapeId;
    }
    for (const item of run.items) {
      switch (item.type) {
        case "text":
          for (let i = 0; i < item.value.length; i++)
            codes.push(item.value.charCodeAt(i));
          break;
        case "tab": {
          const width = item.width ?? 0;
          const data = item.textData ? [...item.textData] : [];
          data[0] = width & 0xffff;
          data[1] = (width >>> 16) & 0xffff;
          pushInline(CHAR_TAB, data);
          break;
        }
        case "lineBreak":
          mark(CHAR_LINE_BREAK);
          codes.push(CHAR_LINE_BREAK);
          break;
        // 한글은 문단에 든 char 컨트롤도 controlMask에 켠다. 0x1F는 저장소 파일에서 확인했고
        // 0x18, 0x1E는 같은 규칙으로 본다. 0x0D(문단 끝)는 켜지 않는다.
        case "specialChar":
          switch (item.char) {
            case "hyphen":
              mark(CHAR_HYPHEN);
              codes.push(CHAR_HYPHEN);
              break;
            case "nbsp":
              mark(CHAR_NBSP);
              codes.push(CHAR_NBSP);
              break;
            case "fixedWidthSpace":
              mark(CHAR_FIXED_SPACE);
              codes.push(CHAR_FIXED_SPACE);
              break;
            case "titleMark":
              pushInline(CHAR_TITLE_MARK);
              break;
          }
          break;
        case "pageBreak":
        case "columnBreak":
          break;
        case "fieldEnd":
          pushInline(CHAR_FIELD_END, item.textData);
          break;
        default:
          pushExtended(controlCharFor(item), item);
          break;
      }
    }
  }

  if (charShapes.length === 0) {
    charShapes.push({
      position: 0,
      charShapeId: paragraph.runs[0]?.charShapeId ?? 0,
    });
  }

  // 문단 끝 글자에 글자 모양이 따로 있으면 그 자리에서 바꾼다.
  const paraEndShapeId = paragraph.paraEndCharShapeId;
  if (paraEndShapeId !== undefined && paraEndShapeId !== lastShapeId)
    charShapes.push({ position: codes.length, charShapeId: paraEndShapeId });

  // HWP 문단의 문자 수와 PARA_TEXT에는 끝의 PARA_BREAK도 포함된다.
  codes.push(CHAR_PARA_BREAK);

  return { codes, charShapes, extended, controlMask };
}

function ctrlIdFor(control: Control): string {
  switch (control.type) {
    case "table":
      return CtrlId.Table;
    case "picture":
      return CtrlId.DrawingObject;
    case "header":
      return CtrlId.Header;
    case "footer":
      return CtrlId.Footer;
    case "footnote":
      return CtrlId.Footnote;
    case "endnote":
      return CtrlId.Endnote;
    case "hiddenComment":
      return CtrlId.HiddenComment;
    case "bookmark":
      return CtrlId.Bookmark;
    case "pageHiding":
      return CtrlId.PageHiding;
    case "autoNumber":
      return CtrlId.AutoNumber;
    case "fieldBegin":
      return fieldCtrlId(control);
    case "unknown":
      return control.ctrlId;
    default:
      return CtrlId.DrawingObject;
  }
}

function controlCharFor(control: Control): number {
  switch (control.type) {
    case "table":
    case "picture":
    case "equation":
    case "line":
    case "rectangle":
    case "ellipse":
    case "arc":
    case "polygon":
    case "curve":
    case "container":
    case "textArt":
    case "ole":
      return CHAR_OBJECT;
    case "header":
    case "footer":
      return 0x10;
    case "footnote":
    case "endnote":
      return 0x11;
    case "autoNumber":
    case "newNumber":
      return 0x12;
    case "pageNumberPosition":
    case "pageHiding":
    case "pageOddEvenAdjust":
      return 0x15;
    case "bookmark":
    case "indexMark":
      return 0x16;
    case "dutmal":
    case "compose":
      return 0x17;
    case "hiddenComment":
      return 0x0f;
    case "fieldBegin":
      return CHAR_FIELD_START;
    case "unknown":
      return control.charCode ?? CHAR_OBJECT;
    default:
      return CHAR_OBJECT;
  }
}

function writeParagraph(
  writer: RecordWriter,
  doc: HwpDocument,
  paragraph: Paragraph,
  sectionForDefinition?: Section,
  lastInList = false,
  cellWidth?: number,
  memos?: Memo[],
): void {
  const encoded = encodeParagraphText(paragraph, sectionForDefinition);
  const table = paragraph.runs
    .flatMap((run) => run.items)
    .find((item) => item.type === "table");
  // 읽은 문단은 원본 줄 배치를 그대로, 새 문단은 표·셀에만 한 줄짜리를 만든다.
  const lineSegments =
    paragraph.lineSegments ??
    (table !== undefined || cellWidth !== undefined
      ? [defaultLineSegment(table?.placement.height, cellWidth)]
      : []);
  const rangeTags = paragraph.rangeTags ?? [];

  const header = new ByteWriter();
  // 비트 31은 이 문단이 현재 문단 리스트의 마지막임을 표시한다.
  header.uint32((encoded.codes.length | (lastInList ? 0x80000000 : 0)) >>> 0);
  header.uint32(encoded.controlMask);
  header.uint16(paragraph.paraShapeId);
  header.uint8(paragraph.styleId);

  let divideSort = (paragraph.divideSortUnknownBits ?? 0) & ~DIVIDE_SORT_KNOWN;
  // 구역 첫 문단은 secd·cold를 내보내므로 한글처럼 구역(0x01)·다단(0x02) 나누기를 켠다.
  if (sectionForDefinition) divideSort |= 0x03;
  divideSort = setBit(divideSort, 3, paragraph.columnBreak);
  divideSort = setBit(divideSort, 2, paragraph.pageBreak);
  header.uint8(divideSort);

  header.uint16(encoded.charShapes.length);
  header.uint16(rangeTags.length);
  header.uint16(lineSegments.length);
  header.uint32(paragraph.id ?? 0);
  // 5.0.3.2 이전 파일은 이 필드 없이 22바이트로 쓴다. 샘플의 5.0.2.5 파일 15개가 모두 그렇다.
  if (versionNumber(doc.version) >= 0x05000302) {
    header.uint16(paragraph.trackChangeMerged ?? 0);
  }

  writer.nested(SectionTag.ParaHeader, header, () => {
    // 빈 문단(PARA_BREAK뿐)은 PARA_TEXT를 생략한다. 한글은 그 레코드가 있으면
    // 파일을 손상됐다고 거부한다. 실제 한글 파일의 빈 문단 26만여 개 모두 생략돼 있었다.
    if (encoded.codes.length > 1) {
      const text = new ByteWriter();
      for (const code of encoded.codes) text.uint16(code);
      writer.write(SectionTag.ParaText, text);
    }

    const shapes = new ByteWriter();
    for (const entry of encoded.charShapes) {
      shapes.uint32(entry.position);
      shapes.uint32(entry.charShapeId);
    }
    writer.write(SectionTag.ParaCharShape, shapes);

    // 순서는 태그 번호 순(표 57)이고 한글 파일도 같다: 글자 모양, 줄 배치, 영역 태그, 컨트롤.
    // 샘플에 영역 태그를 가진 파일은 없어 그 위치는 태그 번호 순서로만 정했다.
    if (lineSegments.length > 0) {
      const segs = new ByteWriter();
      for (const seg of lineSegments) {
        const f = seg.flags;
        let flags = (f.unknownBits ?? 0) & ~LINE_SEGMENT_KNOWN;
        flags = setBit(flags, 0, f.firstLineInPage);
        flags = setBit(flags, 1, f.firstLineInColumn);
        flags = setBit(flags, 16, f.emptySegment);
        flags = setBit(flags, 17, f.firstSegmentInLine);
        flags = setBit(flags, 18, f.lastSegmentInLine);
        flags = setBit(flags, 19, f.autoHyphenation);
        flags = setBit(flags, 20, f.indentation);
        flags = setBit(flags, 21, f.headingApplied);
        segs
          .uint32(seg.textStart)
          .int32(seg.y)
          .int32(seg.height)
          .int32(seg.textHeight)
          .int32(seg.baselineGap)
          .int32(seg.lineSpacing)
          .int32(seg.x)
          .int32(seg.width)
          .uint32(flags);
      }
      writer.write(SectionTag.ParaLineSeg, segs);
    }

    if (rangeTags.length > 0) {
      const tags = new ByteWriter();
      for (const tag of rangeTags) {
        if (
          tag.kind < 0 ||
          tag.kind > 0xff ||
          tag.data < 0 ||
          tag.data > 0xffffff
        )
          throw new HwpFormatError(
            `영역 태그 종류는 0~255, 데이터는 24비트여야 합니다: ${tag.kind}, ${tag.data}`,
          );
        tags
          .uint32(tag.start)
          .uint32(tag.end)
          .uint32(((tag.kind << 24) | tag.data) >>> 0);
      }
      writer.write(SectionTag.ParaRangeTag, tags);
    }

    for (const { control } of encoded.extended) {
      writeControl(writer, doc, control, sectionForDefinition);
    }

    // 한글은 메모를 컨트롤 뒤에 둔다(정오표 71).
    for (const memo of memos ?? []) {
      writer.write(SectionTag.MemoList, new ByteWriter().uint32(memo.id));
      writeNestedParagraphs(writer, doc, memo);
    }
  });
}

/** 새로 만든 표 문단·셀 문단에 넣던 한 줄짜리 줄 배치. 값은 이전 쓰기 코드 그대로다. */
function defaultLineSegment(
  tableHeight: number | undefined,
  cellWidth: number | undefined,
): LineSegment {
  const height = tableHeight ?? 1300;
  return {
    textStart: 0,
    y: 0,
    height,
    textHeight: height,
    baselineGap: tableHeight !== undefined ? height : 1100,
    lineSpacing: tableHeight !== undefined ? 600 : 780,
    x: 0,
    width: cellWidth ?? 0,
    flags: { firstSegmentInLine: true, lastSegmentInLine: true },
  };
}

function writeControl(
  writer: RecordWriter,
  doc: HwpDocument,
  control: Control,
  section?: Section,
): void {
  if (
    control.type === "unknown" &&
    control.ctrlId === CtrlId.SectionDefinition &&
    section
  ) {
    writeSectionDefinition(writer, doc, section);
    return;
  }
  if (
    control.type === "unknown" &&
    control.ctrlId === CtrlId.ColumnDefinition &&
    section
  ) {
    writeColumnDefinition(writer, section);
    return;
  }

  switch (control.type) {
    case "table":
      writeTable(writer, doc, control);
      return;
    case "header":
    case "footer": {
      const header = new ByteWriter()
        .uint32(
          writeCtrlId(
            control.type === "header" ? CtrlId.Header : CtrlId.Footer,
          ),
        )
        .uint32(
          setBits((control.unknownBits ?? 0) & ~0x3, 0, 1, control.applyTo),
        );
      if (control.trailing) header.bytes(control.trailing);
      writer.nested(SectionTag.CtrlHeader, header, () => {
        writeNestedParagraphs(writer, doc, control);
      });
      return;
    }
    case "footnote":
    case "endnote":
    case "hiddenComment": {
      const header = new ByteWriter().uint32(writeCtrlId(ctrlIdFor(control)));
      if (control.trailing) header.bytes(control.trailing);
      writer.nested(SectionTag.CtrlHeader, header, () => {
        writeNestedParagraphs(writer, doc, control);
      });
      return;
    }
    case "bookmark": {
      const header = new ByteWriter().uint32(writeCtrlId(CtrlId.Bookmark));
      writer.nested(SectionTag.CtrlHeader, header, () => {
        const data = new ByteWriter().uint32(0).string(control.name);
        writer.write(SectionTag.CtrlData, data);
      });
      return;
    }
    case "fieldBegin": {
      let props = (control.unknownBits ?? 0) & ~FIELD_KNOWN;
      props = setBit(props, 0, control.editable);
      props = setBit(props, 15, control.dirty);
      const header = new ByteWriter()
        .uint32(writeCtrlId(fieldCtrlId(control)))
        .uint32(props)
        .uint8(control.extraProperties ?? 0)
        .string(control.command ?? "")
        .uint32(control.instanceId ?? 0);
      if (control.trailing) header.bytes(control.trailing);
      writer.nested(SectionTag.CtrlHeader, header, () => {
        if (control.ctrlData)
          writer.write(SectionTag.CtrlData, control.ctrlData);
      });
      return;
    }
    case "picture":
      writeShape(
        writer,
        doc,
        control,
        "$pic",
        SectionTag.ShapeComponentPicture,
        writePictureShape(control),
      );
      return;
    case "rectangle":
      writeShape(
        writer,
        doc,
        control,
        "$rec",
        SectionTag.ShapeComponentRectangle,
        writeShapeRectangle(control),
      );
      return;
    case "line":
      writeShape(
        writer,
        doc,
        control,
        "$lin",
        SectionTag.ShapeComponentLine,
        writeLineShape(control),
      );
      return;
    case "ellipse":
      writeShape(
        writer,
        doc,
        control,
        "$ell",
        SectionTag.ShapeComponentEllipse,
        writeEllipseShape(control),
      );
      return;
    case "arc":
      writeShape(
        writer,
        doc,
        control,
        "$arc",
        SectionTag.ShapeComponentArc,
        writeArcShape(control),
      );
      return;
    case "polygon":
      writeShape(
        writer,
        doc,
        control,
        "$pol",
        SectionTag.ShapeComponentPolygon,
        writePolygonShape(control),
      );
      return;
    case "curve":
      writeShape(
        writer,
        doc,
        control,
        "$cur",
        SectionTag.ShapeComponentCurve,
        writeCurveShape(control),
      );
      return;
    case "autoNumber": {
      let props = (control.unknownBits ?? 0) & ~AUTO_NUMBER_KNOWN;
      props = setBits(props, 0, 3, control.numberKind);
      props = setBits(props, 4, 11, control.numberFormat);
      props = setBit(props, 12, control.supscript);
      const char = (value: string | undefined): number =>
        value?.charCodeAt(0) ?? 0;
      writer.write(
        SectionTag.CtrlHeader,
        new ByteWriter()
          .uint32(writeCtrlId(CtrlId.AutoNumber))
          .uint32(props)
          .uint16(control.number ?? 1)
          .uint16(char(control.userChar))
          .uint16(char(control.prefix))
          .uint16(char(control.suffix)),
      );
      return;
    }
    case "pageHiding": {
      let props = (control.unknownBits ?? 0) & ~PAGE_HIDING_KNOWN;
      props = setBit(props, 0, control.hideHeader);
      props = setBit(props, 1, control.hideFooter);
      props = setBit(props, 2, control.hideMasterPage);
      props = setBit(props, 3, control.hideBorder);
      props = setBit(props, 4, control.hideFill);
      props = setBit(props, 5, control.hidePageNumber);
      writer.write(
        SectionTag.CtrlHeader,
        new ByteWriter().uint32(writeCtrlId(CtrlId.PageHiding)).uint32(props),
      );
      return;
    }
    case "unknown":
      writeUnknownControl(writer, doc, control);
      return;
    default:
      writer.write(
        SectionTag.CtrlHeader,
        new ByteWriter().uint32(writeCtrlId(CtrlId.DrawingObject)),
      );
      return;
  }
}

/**
 * LIST_HEADER와 문단 리스트를 쓴다. 한글처럼 문단을 LIST_HEADER의 형제로 둔다(정오표 53, 68).
 * 문단 수는 UINT32다(정정 83). 새로 만든 리스트는 헤더 8바이트만 쓰고, 세로 정렬이 없으면 위(0)로
 * 쓴다.
 */
function writeNestedParagraphs(
  writer: RecordWriter,
  doc: HwpDocument,
  list: OpaqueParagraphList,
): void {
  const { paragraphs } = list;
  const listHeader = writeListHeader(
    new ByteWriter(),
    paragraphs.length,
    listPropertiesBits(list, VerticalAlign.Top),
  );
  if (list.listTrailing) listHeader.bytes(list.listTrailing);
  writer.write(SectionTag.ListHeader, listHeader);
  paragraphs.forEach((paragraph, index) =>
    writeParagraph(
      writer,
      doc,
      paragraph,
      undefined,
      index === paragraphs.length - 1,
    ),
  );
}

function writeSectionDefinition(
  writer: RecordWriter,
  doc: HwpDocument,
  section: Section,
): void {
  const p = section.properties ?? {};
  let props = (p.unknownBits ?? 0) & ~SECTION_KNOWN;
  props = setBit(props, 0, p.hideFirstHeader);
  props = setBit(props, 1, p.hideFirstFooter);
  props = setBit(props, 2, p.hideFirstMasterPage);
  props = setBit(props, 3, p.hideFirstPageBorder);
  props = setBit(props, 4, p.hideFirstPageFill);
  props = setBit(props, 5, p.hideFirstPageNumber);
  props = setBit(props, 8, p.showFirstPageBorderOnly);
  props = setBit(props, 9, p.showFirstPageFillOnly);
  props = setBit(props, 19, p.hideEmptyLines);
  props = setBits(props, 20, 21, p.pageNumberStart ?? PageNumberStart.Continue);

  const version = versionNumber(doc.version);
  const header = new ByteWriter()
    .uint32(writeCtrlId(CtrlId.SectionDefinition))
    .uint32(props)
    // 새 구역은 한글 새 문서의 값(4mm, 40pt)을 따른다.
    .hwpUnit16(p.columnSpacing ?? 1134)
    .hwpUnit16(p.lineGrid ?? 0)
    .hwpUnit16(p.charGrid ?? 0)
    .uint32(p.defaultTabStop ?? 8000)
    .uint16(toIdRef(p.outlineNumberingId, "번호 문단 모양"))
    .uint16(p.startNumbers?.page ?? 0)
    .uint16(p.startNumbers?.picture ?? 0)
    .uint16(p.startNumbers?.table ?? 0)
    .uint16(p.startNumbers?.equation ?? 0);
  if (p.language !== undefined || version >= 0x05000105)
    header.uint16(p.language ?? 0);
  // 새 구역의 끝 바이트는 한글이 저장한 길이를 따른다: 5.0.4.0 이상 17B, 그 전 8B(정오표 55).
  header.bytes(sectionTrailingBytes(p, version >= 0x05000400 ? 17 : 8));

  writer.nested(SectionTag.CtrlHeader, header, () => {
    const { pageDef } = section;
    let pageProps = (pageDef.unknownBits ?? 0) & ~PAGE_DEF_KNOWN;
    pageProps = setBit(pageProps, 0, pageDef.landscape);
    pageProps = setBits(pageProps, 1, 2, pageDef.gutterKind);
    writer.write(
      SectionTag.PageDef,
      new ByteWriter()
        .hwpUnit(pageDef.width)
        .hwpUnit(pageDef.height)
        .hwpUnit(pageDef.margins.left)
        .hwpUnit(pageDef.margins.right)
        .hwpUnit(pageDef.margins.top)
        .hwpUnit(pageDef.margins.bottom)
        .hwpUnit(pageDef.margins.header)
        .hwpUnit(pageDef.margins.footer)
        .hwpUnit(pageDef.margins.gutter)
        .uint32(pageProps),
    );

    // 한글이 파일을 열려면 각주와 미주 모양이 반드시 있어야 한다.
    writer.write(
      SectionTag.FootnoteShape,
      noteShapeBytes(section.footnoteShape ?? defaultNoteShape(false)),
    );
    writer.write(
      SectionTag.FootnoteShape,
      noteShapeBytes(section.endnoteShape ?? defaultNoteShape(true)),
    );
    for (const fill of section.pageBorderFills ?? DEFAULT_PAGE_BORDER_FILLS) {
      let fillProps = (fill.unknownBits ?? 0) & ~PAGE_BORDER_FILL_KNOWN;
      fillProps = setBit(fillProps, 0, fill.relativeToPage);
      fillProps = setBit(fillProps, 1, fill.includeHeader);
      fillProps = setBit(fillProps, 2, fill.includeFooter);
      fillProps = setBits(fillProps, 3, 4, fill.fillArea);
      writer.write(
        SectionTag.PageBorderFill,
        new ByteWriter()
          .uint32(fillProps)
          .hwpUnit16(fill.offsetLeft)
          .hwpUnit16(fill.offsetRight)
          .hwpUnit16(fill.offsetTop)
          .hwpUnit16(fill.offsetBottom)
          .uint16(toIdRef(fill.borderFillId, "쪽 테두리/배경")),
      );
    }

    for (const masterPage of section.masterPages ?? []) {
      writeNestedParagraphs(writer, doc, masterPage);
    }
  });
}

/** 새 구역의 쪽 테두리/배경. 이전 쓰기 코드의 값 그대로다. */
const DEFAULT_PAGE_BORDER_FILLS: readonly PageBorderFill[] = Array.from(
  { length: 3 },
  () => ({
    relativeToPage: true,
    fillArea: 0,
    offsetLeft: 1417,
    offsetRight: 1417,
    offsetTop: 1417,
    offsetBottom: 1417,
  }),
);

/** 새 구역의 각주/미주 모양. 한글 새 문서가 저장하는 값이다(정오표 E23). */
function defaultNoteShape(endnote: boolean): NoteShape {
  return {
    numberFormat: 0,
    suffix: ")",
    startNumber: 1,
    numbering: 0,
    placement: 0,
    separatorLength: endnote ? 14692344 : -1,
    aboveSpacing: 850,
    belowSpacing: 567,
    betweenSpacing: endnote ? 0 : 283,
    separatorStyle: 1,
    separatorWidth: 1,
    separatorColor: rgb(0, 0, 0),
  };
}

/** 표 133. 구분선 길이는 4바이트다(정오표 59). */
function noteShapeBytes(shape: NoteShape): ByteWriter {
  let props = (shape.unknownBits ?? 0) & ~NOTE_SHAPE_KNOWN;
  props = setBits(props, 0, 7, shape.numberFormat);
  props = setBits(props, 8, 9, shape.placement);
  props = setBits(props, 10, 11, shape.numbering);
  props = setBit(props, 12, shape.superscript);
  props = setBit(props, 13, shape.beneathText);
  const char = (value: string | undefined): number => value?.charCodeAt(0) ?? 0;
  return new ByteWriter()
    .uint32(props)
    .uint16(char(shape.userChar))
    .uint16(char(shape.prefix))
    .uint16(char(shape.suffix))
    .uint16(shape.startNumber)
    .int32(shape.separatorLength)
    .hwpUnit16(shape.aboveSpacing)
    .hwpUnit16(shape.belowSpacing)
    .hwpUnit16(shape.betweenSpacing)
    .uint8(shape.separatorStyle)
    .uint8(shape.separatorWidth)
    .color(shape.separatorColor);
}

function writeColumnDefinition(writer: RecordWriter, section: Section): void {
  const count = section.columnDef?.count ?? 1;
  let properties = 0;
  properties = setBits(properties, 0, 1, section.columnDef?.kind ?? 0);
  properties = setBits(properties, 2, 9, count);
  properties = setBit(properties, 12, section.columnDef?.sameWidth ?? true);
  writer.write(
    SectionTag.CtrlHeader,
    new ByteWriter()
      .uint32(writeCtrlId(CtrlId.ColumnDefinition))
      .uint16(properties)
      .uint16(section.columnDef?.gap ?? 0)
      .uint16(0)
      .uint8(0)
      .uint8(0)
      .color(rgb(0, 0, 0)),
  );
}

function writeTable(
  writer: RecordWriter,
  doc: HwpDocument,
  table: Extract<Control, { type: "table" }>,
): void {
  const header = new ByteWriter().uint32(writeCtrlId(CtrlId.Table));
  const { caption } = table.placement;
  writeObjectPlacement(header, table.placement, 2, caption !== undefined);

  writer.nested(SectionTag.CtrlHeader, header, () => {
    // 캡션은 TABLE 레코드보다 앞, CTRL_HEADER의 첫 자식이다(table-caption-bottom.hwp).
    if (caption) writeCaption(writer, doc, caption, table.placement.width);
    const body = new ByteWriter();
    let properties = (table.unknownBits ?? 0) & ~TABLE_PROPERTIES_KNOWN;
    // 쪽 경계에서 나눔이 없으면 한글의 새 표처럼 "나눔"(2)을 쓴다(정정 88).
    properties = setBits(
      properties,
      0,
      1,
      table.pageBreak ?? PageBreakInTable.Split,
    );
    properties = setBit(properties, 2, (table.repeatHeaderRows ?? 0) > 0);
    properties = setBit(properties, 3, table.noAdjust ?? false);
    body.uint32(properties);
    body.uint16(table.rows.length);
    body.uint16(
      Math.max(
        ...table.rows.map((r) => r.cells.reduce((n, c) => n + c.colSpan, 0)),
        1,
      ),
    );
    body.hwpUnit16(table.cellSpacing ?? 0);
    body.hwpUnit16(table.cellMargins.left);
    body.hwpUnit16(table.cellMargins.right);
    body.hwpUnit16(table.cellMargins.top);
    body.hwpUnit16(table.cellMargins.bottom);
    for (const row of table.rows) body.uint16(row.cells.length);
    body.uint16(toIdRef(table.borderFillId, "표 테두리 ID"));
    const zones = table.cellZones ?? [];
    if (zones.length > 0xffff)
      throw new RangeError(
        `셀 영역 ${zones.length}개는 65535개를 넘을 수 없다.`,
      );
    body.uint16(zones.length);
    for (const zone of zones) writeCellZone(body, zone);

    writer.write(SectionTag.Table, body);

    for (const row of table.rows) {
      for (const cell of row.cells) writeTableCell(writer, doc, cell);
    }
  });
}

/** 영역 속성(표 78): 시작 열·행, 끝 열·행, 테두리/배경 참조. */
function writeCellZone(body: ByteWriter, zone: CellZone): void {
  const { startRow, startCol, endRow, endCol } = zone;
  for (const [name, value] of Object.entries({
    startRow,
    startCol,
    endRow,
    endCol,
  })) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff)
      throw new RangeError(`셀 영역 ${name} ${value}는 0~65535 정수여야 한다.`);
  }
  body
    .uint16(startCol)
    .uint16(startRow)
    .uint16(endCol)
    .uint16(endRow)
    .uint16(toIdRef(zone.borderFillId, "셀 영역 테두리 ID"));
}

function writeTableCell(
  writer: RecordWriter,
  doc: HwpDocument,
  cell: TableCell,
): void {
  const header = new ByteWriter();
  writeListHeader(header, cell.paragraphs.length, cellListProperties(cell));

  header.uint16(cell.col);
  header.uint16(cell.row);
  header.uint16(cell.colSpan);
  header.uint16(cell.rowSpan);
  header.uint32(cell.width);
  header.uint32(cell.height);
  header.uint16(cell.margins?.left ?? 0);
  header.uint16(cell.margins?.right ?? 0);
  header.uint16(cell.margins?.top ?? 0);
  header.uint16(cell.margins?.bottom ?? 0);
  header.uint16(toIdRef(cell.borderFillId, "셀 테두리 ID"));
  // 읽은 셀은 표 80 뒤 바이트를 그대로, 새 셀은 한글처럼 셀 폭과 0 9바이트를 쓴다.
  if (cell.trailing) header.bytes(cell.trailing);
  else header.uint32(cell.width).bytes(new Uint8Array(9));

  writer.write(SectionTag.ListHeader, header);
  cell.paragraphs.forEach((paragraph, index) => {
    writeParagraph(
      writer,
      doc,
      paragraph,
      undefined,
      index === cell.paragraphs.length - 1,
      cell.width,
    );
  });
}

/**
 * 모델이 해석하지 않는 컨트롤. 개체 공통 속성을 읽은 그리기 개체는 CTRL_HEADER와 캡션을
 * 모델로 쓰고, 그 밖에는 원본 페이로드를 쓴다. 하위 레코드는 읽은 그대로 붙인다.
 */
function writeUnknownControl(
  writer: RecordWriter,
  doc: HwpDocument,
  control: UnknownControl,
): void {
  const { placement } = control;
  let header: Uint8Array | ByteWriter;
  if (placement && !control.raw) {
    header = new ByteWriter().uint32(writeCtrlId(control.ctrlId));
    writeObjectPlacement(header, placement, 0, placement.caption !== undefined);
  } else {
    header =
      control.raw ?? new ByteWriter().uint32(writeCtrlId(control.ctrlId));
  }
  writer.nested(SectionTag.CtrlHeader, header, () => {
    // 캡션은 SHAPE_COMPONENT보다 앞, CTRL_HEADER의 첫 자식이다(rect-caption-bottom.hwp).
    if (placement?.caption && !control.raw)
      writeCaption(writer, doc, placement.caption, placement.width);
    if (control.shapeComponent)
      writer.write(
        SectionTag.ShapeComponent,
        writeShapeComponent(control.shapeComponent),
      );
    for (const r of control.childRecords ?? [])
      writer.writeAt(r.depth, r.tagId, r.payload);
  });
}

/**
 * 모델로 읽은 도형: CTRL_HEADER, 캡션, SHAPE_COMPONENT, 글상자, 미해석 자식, 그리고 SHAPE_COMPONENT의
 * 마지막 자식인 도형별 레코드(`specific`) 순서로 쓴다.
 */
function writeShape(
  writer: RecordWriter,
  doc: HwpDocument,
  control: ModeledShape,
  shapeId: string,
  tag: number,
  specific: ByteWriter,
): void {
  const { type: _, placement, textBox, childRecords, ...shape } = control;
  const header = new ByteWriter().uint32(writeCtrlId(CtrlId.DrawingObject));
  // 번호 종류 기본값: 그림은 1(그림), 그리기 개체는 0(없음).
  const objectKind = control.type === "picture" ? 1 : 0;
  writeObjectPlacement(
    header,
    placement,
    objectKind,
    placement.caption !== undefined,
  );
  writer.nested(SectionTag.CtrlHeader, header, () => {
    // 캡션은 SHAPE_COMPONENT보다 앞, CTRL_HEADER의 첫 자식이다(rect-caption-bottom.hwp).
    if (placement.caption)
      writeCaption(writer, doc, placement.caption, placement.width);
    writer.write(
      SectionTag.ShapeComponent,
      writeShapeComponent({ shapeId, ...shape }),
    );
    if (textBox) writer.descend(() => writeTextBox(writer, doc, textBox));
    for (const r of childRecords ?? [])
      writer.writeAt(r.depth, r.tagId, r.payload);
    writer.writeAt(1, tag, specific.finish());
  });
}

function writeObjectPlacement(
  writer: ByteWriter,
  placement: Extract<Control, { type: "table" }>["placement"],
  objectKind: number,
  writesCaption: boolean,
): void {
  let properties = (placement.unknownBits ?? 0) & OBJECT_UNKNOWN_BITS;
  properties = setBit(properties, 0, placement.treatAsChar);
  properties = setBit(properties, 2, placement.affectLineSpacing);
  // 모델의 Paragraph는 3이지만 HWP 세로 기준에서 문단은 2다.
  properties = setBits(
    properties,
    3,
    4,
    placement.vertRelTo === RelativeTo.Paragraph ? 2 : placement.vertRelTo,
  );
  properties = setBits(properties, 5, 7, placement.vertAlign ?? 0);
  properties = setBits(properties, 8, 9, placement.horzRelTo);
  properties = setBits(properties, 10, 12, placement.horzAlign ?? 0);
  properties = setBit(
    properties,
    13,
    placement.flowWithText ?? objectKind === 2,
  );
  properties = setBit(properties, 14, placement.allowOverlap);
  properties = setBits(properties, 15, 17, placement.widthCriterion ?? 4);
  properties = setBits(properties, 18, 19, placement.heightCriterion ?? 2);
  properties = setBit(properties, 20, placement.fixedSize);
  properties = setBits(
    properties,
    21,
    23,
    placement.textWrap ?? (objectKind === 2 ? 1 : 0),
  );
  properties = setBits(properties, 24, 25, placement.textFlowSide ?? 0);
  properties = setBits(
    properties,
    26,
    28,
    placement.numberingKind ?? objectKind,
  );
  properties = setBit(properties, 29, writesCaption);
  properties = setBit(properties, 30, placement.locked);

  writer.uint32(properties >>> 0);
  writer.int32(placement.offsetY);
  writer.int32(placement.offsetX);
  writer.uint32(placement.width);
  writer.uint32(placement.height);
  writer.int32(placement.zOrder ?? 0);
  writer.int16(placement.marginLeft ?? 0);
  writer.int16(placement.marginRight ?? 0);
  writer.int16(placement.marginTop ?? 0);
  writer.int16(placement.marginBottom ?? 0);
  writer.uint32(placement.instanceId ?? 0);
  writer.int32(placement.keepWithAnchor ? 1 : 0);
  if (placement.trailing === null) return;
  writer.string(placement.description ?? "");
  // 새 개체는 명세 길이(46 + 2×len)로 쓴다. 한글은 이 길이도 읽는다(저장소 표 148개).
  writer.bytes(Uint8Array.from(placement.trailing ?? []));
}
