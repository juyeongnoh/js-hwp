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
  type Control,
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
  PageBreakInTable,
  RelativeTo,
  type TableCell,
  type TableRow,
  VerticalAlign,
  defaultPageDef,
  rgb,
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
import { versionNumber } from "./docinfo.js";
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

/** 파일에서 셀 세로 정렬은 0=위, 1=가운데, 2=아래다. */
export const CELL_VERTICAL_ALIGN_FROM_WIRE = [
  VerticalAlign.Top,
  VerticalAlign.Center,
  VerticalAlign.Bottom,
];

/** 모델의 VerticalAlign으로 인덱싱한다. Baseline은 셀에 대응물이 없다. */
export const CELL_VERTICAL_ALIGN_TO_WIRE = [0, 0, 1, 2];

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
  if (paragraph.runs.length === 0)
    paragraph.runs.push({ charShapeId: 0, items: [] });
  // 레코드가 없어도 빈 배열로 둔다. 쓸 때 줄 배치를 새로 만들지 않고 없던 그대로 쓰게 한다.
  paragraph.lineSegments = lineSegRecord ? readParaLineSeg(lineSegRecord) : [];
  if (rangeTagRecord) paragraph.rangeTags = readParaRangeTag(rangeTagRecord);
  return paragraph;
}

/** 표 62. 36바이트 항목이 문단 머리의 줄 정보 수만큼 이어진다. */
function readParaLineSeg(node: RecordNode): LineSegment[] {
  const reader = new ByteReader(node.payload);
  const out: LineSegment[] = [];
  while (reader.hasMore(36)) {
    out.push({
      textStart: reader.uint32(),
      y: reader.int32(),
      height: reader.int32(),
      textHeight: reader.int32(),
      baselineGap: reader.int32(),
      lineSpacing: reader.int32(),
      x: reader.int32(),
      width: reader.int32(),
      flags: reader.uint32(),
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
      const node = controlNodes[controlIndex++];
      const control = node ? readControl(node, context, section) : undefined;
      // 모르는 컨트롤은 텍스트의 제어 문자도 원본대로 다시 쓴다.
      if (control?.type === "unknown") control.charCode = code;
      // 필드는 텍스트 쪽 ctrlId가 CTRL_HEADER와 다를 수 있다(정오표 71).
      if (control?.type === "fieldBegin") {
        control.textData = textData(view, start);
        const kind = FIELD_KIND_BY_CTRL_ID[readCtrlId(view.getUint32((start + 1) * 2, true))];
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
      return { type: "tab", width: width || undefined };
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
  return { type: "unknown", ctrlId, raw: node.payload };
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

interface ParagraphListRead {
  paragraphs: Paragraph[];
  listHeaderRest?: Uint8Array;
}

/**
 * LIST_HEADER로 시작하는 문단 리스트들을 읽는다. 한글은 문단을 LIST_HEADER의 자식이
 * 아니라 같은 레벨의 형제로 뒤에 둔다(정오표 53, 68). 문단 수로 리스트를 가른다.
 * 예전 js-hwp처럼 문단을 LIST_HEADER 아래에 둔 파일도 읽는다.
 */
function readParagraphLists(
  children: RecordNode[],
  context: ParseContext,
): ParagraphListRead[] {
  const lists: ParagraphListRead[] = [];
  let current: ParagraphListRead | undefined;
  let remaining = 0;
  for (const child of children) {
    if (child.tagId === SectionTag.ListHeader) {
      const reader = new ByteReader(child.payload);
      const count = reader.optionalUint16();
      current = { paragraphs: readParagraphList(child.children, context) };
      if (reader.hasMore()) current.listHeaderRest = reader.rest();
      lists.push(current);
      remaining = count - current.paragraphs.length;
    } else if (
      child.tagId === SectionTag.ParaHeader &&
      current &&
      remaining > 0
    ) {
      current.paragraphs.push(readParagraph(child, context));
      remaining--;
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
    const memo: Memo = {
      id: new ByteReader(child.payload).optionalUint32(),
      paragraphs: list?.paragraphs ?? [],
    };
    if (list?.listHeaderRest) memo.listHeaderRest = list.listHeaderRest;
    memos.push(memo);
  });
  return memos;
}

/** 컨트롤 하나에 딸린 문단 리스트. 문단이 없으면 빈 문단 하나를 둔다. */
function readNestedParagraphs(
  node: RecordNode,
  context: ParseContext,
): ParagraphListRead {
  const [list] = readParagraphLists(node.children, context);
  const paragraphs = list?.paragraphs.length
    ? list.paragraphs
    : [{ paraShapeId: 0, styleId: 0, runs: [{ charShapeId: 0, items: [] }] }];
  return list?.listHeaderRest
    ? { paragraphs, listHeaderRest: list.listHeaderRest }
    : { paragraphs };
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

/** 표 130에서 모델이 이름으로 다루는 비트: 0~4, 8~9, 19, 20~21(정오표 E23, E25). */
const SECTION_KNOWN = 0x0030031f | (1 << 19);
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
function sectionTrailingBytes(p: SectionProperties, length: number): Uint8Array {
  const source = p.trailing ?? new Uint8Array(length);
  const hasFields =
    p.memoShapeId !== undefined ||
    (p.textDirection ?? TextDirection.Horizontal) !== TextDirection.Horizontal ||
    p.verticalHeaderFooter === true;
  if (source.length < 7 && !hasFields) return source;
  const trailing = new Uint8Array(Math.max(source.length, 7));
  trailing.set(source);
  const memoShapeRef = toIdRef(p.memoShapeId, "메모 모양");
  trailing[4] = memoShapeRef & 0xff;
  trailing[5] = memoShapeRef >>> 8;
  let flags = setBits(trailing[6]!, 1, 3, p.textDirection ?? TextDirection.Horizontal);
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
    pageBreak = bits(properties, 0, 1);
    repeatHeaderRows = bit(properties, 2) ? 1 : 0;
  }

  // 셀의 문단은 LIST_HEADER의 자식이 아니라 같은 레벨의 뒤따르는 레코드다.
  // LIST_HEADER의 문단 수로 어느 셀에 속하는지 구분한다.
  const rows: TableRow[] = Array.from(
    { length: Math.max(rowCount, 1) },
    () => ({ cells: [] }),
  );
  let currentCell: TableCell | undefined;
  let remainingParagraphs = 0;
  for (const child of node.children) {
    if (child.tagId === SectionTag.ListHeader) {
      currentCell = readTableCell(child, context);
      const row = rows[currentCell.row] ?? rows[rows.length - 1];
      row?.cells.push(currentCell);
      remainingParagraphs =
        new ByteReader(child.payload).optionalUint16() -
        currentCell.paragraphs.length;
    } else if (
      child.tagId === SectionTag.ParaHeader &&
      currentCell &&
      remainingParagraphs > 0
    ) {
      currentCell.paragraphs.push(readParagraph(child, context));
      remainingParagraphs--;
    }
  }

  return {
    type: "table",
    placement,
    rows: rows.filter((row) => row.cells.length > 0),
    cellMargins: margins,
    cellSpacing,
    ...idRefField(borderFillRef),
    pageBreak,
    repeatHeaderRows,
  };
}

function idRefField(ref: number): { borderFillId?: number } {
  const id = fromIdRef(ref);
  return id === undefined ? {} : { borderFillId: id };
}

function readTableCell(node: RecordNode, context: ParseContext): TableCell {
  const reader = new ByteReader(node.payload);
  reader.uint16(); // paragraph count (LIST_HEADER)
  const properties = reader.optionalUint32();
  if (node.payload.length >= 34) reader.optionalUint16(); // width reference (extended LIST_HEADER)

  const col = reader.optionalUint16();
  const row = reader.optionalUint16();
  const colSpan = Math.max(1, reader.optionalUint16(1));
  const rowSpan = Math.max(1, reader.optionalUint16(1));
  const width = reader.optionalUint32();
  const height = reader.optionalUint32();
  const margins = {
    left: reader.optionalUint16(),
    right: reader.optionalUint16(),
    top: reader.optionalUint16(),
    bottom: reader.optionalUint16(),
  };
  const borderFillRef = reader.optionalUint16();

  return {
    col,
    row,
    colSpan,
    rowSpan,
    width,
    height,
    margins,
    ...idRefField(borderFillRef),
    // 파일의 값은 0=위, 1=가운데, 2=아래다. 모델의 VerticalAlign은 셀이 가질
    // 수 없는 Baseline에서 시작하므로 하나 밀어준다.
    verticalAlign: (CELL_VERTICAL_ALIGN_FROM_WIRE[bits(properties, 5, 6)] ??
      VerticalAlign.Top) as VerticalAlign,
    paragraphs: readParagraphList(node.children, context),
  };
}

function readDrawingObject(
  node: RecordNode,
  context: ParseContext,
): Control | undefined {
  const pictureNode = childWithTag(node, SectionTag.ShapeComponentPicture);
  const shapeNode = childWithTag(node, SectionTag.ShapeComponent);
  const reader = new ByteReader(node.payload);
  reader.uint32(); // ctrl id, already consumed by the caller's reader
  const placement = readObjectPlacement(reader);

  if (pictureNode) {
    const p = new ByteReader(pictureNode.payload);
    p.uint8(); // border style
    p.uint8();
    p.uint32();
    p.uint32();
    // 바이너리 데이터 id는 네 모서리 점과 자르기 사각형 뒤에 있다. 모든 필드를
    // 모델링하는 대신 거기까지 건너뛴다.
    const binDataId = findBinDataId(pictureNode.payload);
    return {
      type: "picture",
      binDataId: binDataId ?? 0,
      placement,
    };
  }

  void shapeNode;
  void context;
  return {
    type: "unknown",
    ctrlId: CtrlId.DrawingObject,
    placement,
    raw: node.payload,
  };
}

/**
 * 그림 레코드의 `binItemId`는 고정 크기 접두부 뒤에 오는 UINT16이다. 한글
 * 버전마다 접두부 패딩이 달라서, 고정 오프셋을 믿는 대신 그럴듯한 첫 id를
 * 훑어 찾는다.
 */
function findBinDataId(payload: Uint8Array): number | undefined {
  // 명세가 문서화하는 배치에서 id는 오프셋 74에 저장된다.
  if (payload.length >= 76) {
    const view = new DataView(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength,
    );
    const candidate = view.getUint16(74, true);
    if (candidate > 0 && candidate < 0x1000) return candidate - 1;
  }
  return undefined;
}

function readObjectPlacement(
  reader: ByteReader,
): Control extends { placement: infer P } ? P : never {
  const properties = reader.optionalUint32();
  const offsetY = reader.optionalInt32();
  const offsetX = reader.optionalInt32();
  const width = reader.optionalUint32();
  const height = reader.optionalUint32();
  const zOrder = reader.optionalInt32();
  const marginTop = reader.optionalInt16();
  const marginBottom = reader.optionalInt16();
  const marginLeft = reader.optionalInt16();
  const marginRight = reader.optionalInt16();
  const instanceId = reader.optionalUint32();

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
    textWrap: bits(properties, 21, 23),
    textFlowSide: bits(properties, 24, 25),
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
  } as never;
}

/** 글자 모양 맵을 써서 위치가 정해진 항목들을 run으로 묶는다. */
function buildRuns(
  items: PositionedItem[],
  charShapes: { position: number; charShapeId: number }[],
): Run[] {
  const shapeAt = (position: number): number => {
    let current = charShapes[0]?.charShapeId ?? 0;
    for (const entry of charShapes) {
      if (entry.position > position) break;
      current = entry.charShapeId;
    }
    return current;
  };

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
    controlMask |= 1 << code;
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
    const firstCharShapeId = paragraph.runs[0]?.charShapeId ?? 0;
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
          pushInline(CHAR_TAB, [width & 0xffff, (width >>> 16) & 0xffff]);
          break;
        }
        case "lineBreak":
          mark(CHAR_LINE_BREAK);
          codes.push(CHAR_LINE_BREAK);
          break;
        case "specialChar":
          switch (item.char) {
            case "hyphen":
              codes.push(CHAR_HYPHEN);
              break;
            case "nbsp":
              codes.push(CHAR_NBSP);
              break;
            case "fixedWidthSpace":
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
        segs
          .uint32(seg.textStart)
          .int32(seg.y)
          .int32(seg.height)
          .int32(seg.textHeight)
          .int32(seg.baselineGap)
          .int32(seg.lineSpacing)
          .int32(seg.x)
          .int32(seg.width)
          .uint32(seg.flags);
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
    flags: 0x00060000,
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
        if (control.ctrlData) writer.write(SectionTag.CtrlData, control.ctrlData);
      });
      return;
    }
    case "picture":
      writePicture(writer, doc, control);
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
    default: {
      const raw = control.type === "unknown" ? control.raw : undefined;
      if (raw) writer.write(SectionTag.CtrlHeader, raw);
      else
        writer.write(
          SectionTag.CtrlHeader,
          new ByteWriter().uint32(writeCtrlId(CtrlId.DrawingObject)),
        );
      return;
    }
  }
}

/**
 * LIST_HEADER와 문단 리스트를 쓴다. 한글처럼 문단을 LIST_HEADER의 형제로 둔다(정오표 53, 68).
 * 새로 만든 리스트의 LIST_HEADER는 문단 수 뒤에 속성 0만 쓴다.
 */
function writeNestedParagraphs(
  writer: RecordWriter,
  doc: HwpDocument,
  list: { paragraphs: Paragraph[]; listHeaderRest?: Uint8Array },
): void {
  const { paragraphs } = list;
  const listHeader = new ByteWriter().uint16(paragraphs.length);
  if (list.listHeaderRest) listHeader.bytes(list.listHeaderRest);
  else listHeader.uint32(0);
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
  writeObjectPlacement(header, table.placement, 2);

  writer.nested(SectionTag.CtrlHeader, header, () => {
    const body = new ByteWriter();
    let properties = 0;
    properties = setBits(
      properties,
      0,
      1,
      table.pageBreak ?? PageBreakInTable.Cell,
    );
    properties = setBit(properties, 2, (table.repeatHeaderRows ?? 0) > 0);
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
    body.uint16(0); // valid zone count

    writer.write(SectionTag.Table, body);

    for (const row of table.rows) {
      for (const cell of row.cells) writeTableCell(writer, doc, cell);
    }
  });
}

function writeTableCell(
  writer: RecordWriter,
  doc: HwpDocument,
  cell: TableCell,
): void {
  const header = new ByteWriter();
  header.uint16(cell.paragraphs.length);

  let properties = 0x00200000;
  properties = setBits(
    properties,
    5,
    6,
    CELL_VERTICAL_ALIGN_TO_WIRE[cell.verticalAlign ?? VerticalAlign.Top] ?? 0,
  );
  header.uint32(properties);
  header.uint16(1);

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
  header.uint32(cell.width).bytes(new Uint8Array(9));

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

function writePicture(
  writer: RecordWriter,
  _doc: HwpDocument,
  picture: Extract<Control, { type: "picture" }>,
): void {
  const header = new ByteWriter().uint32(writeCtrlId(CtrlId.DrawingObject));
  writeObjectPlacement(header, picture.placement, 1);

  writer.nested(SectionTag.CtrlHeader, header, () => {
    const shape = new ByteWriter()
      .uint32(0) // instance id
      .int32(0) // x offset in group
      .int32(0)
      .uint32(0) // group level
      .uint16(0) // local version
      .int32(0)
      .int32(0)
      .uint32(picture.placement.width)
      .uint32(picture.placement.height)
      .uint32(0) // rotation
      .int32(0)
      .int32(0);
    writer.write(SectionTag.ShapeComponent, shape);

    const body = new ByteWriter();
    body.uint8(0).uint8(0).uint32(0).uint32(0); // border line
    for (let i = 0; i < 4; i++) {
      body.int32(i === 1 || i === 2 ? picture.placement.width : 0);
      body.int32(i >= 2 ? picture.placement.height : 0);
    }
    body.int32(0).int32(0).int32(0).int32(0); // crop
    body.uint16(0).uint16(0).uint16(0).uint16(0); // inner margins
    body.uint8(0).uint8(0).uint8(0); // brightness, contrast, effect
    body.uint16(picture.binDataId + 1);
    writer.write(SectionTag.ShapeComponentPicture, body);
  });
}

function writeObjectPlacement(
  writer: ByteWriter,
  placement: Extract<Control, { type: "table" }>["placement"],
  objectKind: number,
): void {
  let properties = 0;
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
  properties = setBits(
    properties,
    21,
    23,
    placement.textWrap ?? (objectKind === 2 ? 1 : 0),
  );
  properties = setBits(properties, 24, 25, placement.textFlowSide ?? 0);
  properties = setBits(properties, 26, 28, objectKind);

  writer.uint32(properties);
  writer.int32(placement.offsetY);
  writer.int32(placement.offsetX);
  writer.uint32(placement.width);
  writer.uint32(placement.height);
  writer.int32(placement.zOrder ?? 0);
  writer.int16(placement.marginTop ?? 0);
  writer.int16(placement.marginBottom ?? 0);
  writer.int16(placement.marginLeft ?? 0);
  writer.int16(placement.marginRight ?? 0);
  writer.uint32(placement.instanceId ?? 0);
  writer.int32(0); // prevent page break
  writer.uint16(0); // description length
}
