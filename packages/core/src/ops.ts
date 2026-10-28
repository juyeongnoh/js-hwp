/**
 * 불러온 문서에 대한 포맷 중립 연산: 순회, 텍스트 추출, 제자리 텍스트 편집.
 *
 * 여기 있는 전부가 모델 위에서 동작하므로, `.hwp`에서 왔든 `.hwpx`에서 왔든
 * 빌더에서 왔든 똑같이 적용된다.
 */

import type {
  Control,
  InlineItem,
  Paragraph,
  Run,
  TableCell,
} from "./model/controls.js";
import type { HwpDocument } from "./model/document.js";
import type { Section } from "./model/section.js";

/** 문단이 문서 안 어디에 있는지. 보고와 편집에 쓴다. */
export interface ParagraphLocation {
  sectionIndex: number;
  /** 중첩 컨테이너를 지나는 경로. 예: 표 셀 -> 문단. */
  path: string;
  paragraph: Paragraph;
  /** 문단이 사는 배열. 호출자가 splice할 수 있도록. */
  container: Paragraph[];
  indexInContainer: number;
}

/** 중첩된 것을 포함해 문서의 모든 문단을 순회한다. */
export function* walkParagraphs(
  doc: HwpDocument,
): Generator<ParagraphLocation> {
  for (let s = 0; s < doc.sections.length; s++) {
    yield* walkParagraphList(doc.sections[s]!.paragraphs, s, `section[${s}]`);
  }
}

function* walkParagraphList(
  paragraphs: Paragraph[],
  sectionIndex: number,
  path: string,
): Generator<ParagraphLocation> {
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i]!;
    const here = `${path}/p[${i}]`;
    yield {
      sectionIndex,
      path: here,
      paragraph,
      container: paragraphs,
      indexInContainer: i,
    };

    for (const run of paragraph.runs) {
      for (const item of run.items) {
        yield* walkNested(item, sectionIndex, here);
      }
    }
  }
}

function* walkNested(
  item: InlineItem,
  sectionIndex: number,
  path: string,
): Generator<ParagraphLocation> {
  switch (item.type) {
    case "table":
      for (let r = 0; r < item.rows.length; r++) {
        for (const cell of item.rows[r]!.cells) {
          yield* walkParagraphList(
            cell.paragraphs,
            sectionIndex,
            `${path}/table/cell[${cell.row},${cell.col}]`,
          );
        }
      }
      if (item.placement.caption) {
        yield* walkParagraphList(
          item.placement.caption.paragraphs,
          sectionIndex,
          `${path}/caption`,
        );
      }
      break;
    case "header":
    case "footer":
    case "footnote":
    case "endnote":
    case "hiddenComment":
    case "memo":
      yield* walkParagraphList(
        item.paragraphs,
        sectionIndex,
        `${path}/${item.type}`,
      );
      break;
    case "container":
      for (const child of item.children)
        yield* walkNested(child, sectionIndex, `${path}/container`);
      break;
    default:
      if ("textBox" in item && item.textBox) {
        yield* walkParagraphList(
          item.textBox.paragraphs,
          sectionIndex,
          `${path}/textbox`,
        );
      }
      if ("placement" in item && item.placement?.caption) {
        yield* walkParagraphList(
          item.placement.caption.paragraphs,
          sectionIndex,
          `${path}/caption`,
        );
      }
      break;
  }
}

/** 문서의 모든 컨트롤을 깊이 우선으로 순회한다. */
export function* walkControls(doc: HwpDocument): Generator<Control> {
  for (const { paragraph } of walkParagraphs(doc)) {
    for (const run of paragraph.runs) {
      for (const item of run.items) {
        if (isControl(item)) yield item;
      }
    }
  }
}

const INLINE_TYPES = new Set([
  "text",
  "tab",
  "lineBreak",
  "columnBreak",
  "pageBreak",
  "specialChar",
]);

export function isControl(item: InlineItem): item is Control {
  return !INLINE_TYPES.has(item.type);
}

// ---------------------------------------------------------------------------
// 텍스트 추출
// ---------------------------------------------------------------------------

export interface TextOptions {
  /** 문단 사이에 놓는 텍스트. 기본값 `'\n'`. */
  paragraphSeparator?: string;
  /** 표 셀 내용을 포함한다. 기본값 `true`. */
  includeTables?: boolean;
  /** 머리말, 꼬리말, 각주, 미주를 포함한다. 기본값 `false`. */
  includeNotes?: boolean;
  /** 탭을 나타내는 데 쓰는 텍스트. 기본값 `'\t'`. */
  tab?: string;
  /** 표 한 행의 셀 사이 구분자. 기본값 `'\t'`. */
  cellSeparator?: string;
}

/** 문단의 평문을 뽑아낸다. */
export function paragraphText(
  paragraph: Paragraph,
  options: TextOptions = {},
): string {
  const tab = options.tab ?? "\t";
  let out = "";
  for (const run of paragraph.runs) {
    for (const item of run.items) {
      switch (item.type) {
        case "text":
          out += item.value;
          break;
        case "tab":
          out += tab;
          break;
        case "lineBreak":
          out += "\n";
          break;
        case "specialChar":
          out += item.char === "hyphen" ? "-" : " ";
          break;
        default:
          break;
      }
    }
  }
  return out;
}

/** 문서 전체의 평문을 뽑아낸다. */
export function documentText(
  doc: HwpDocument,
  options: TextOptions = {},
): string {
  const separator = options.paragraphSeparator ?? "\n";
  const includeTables = options.includeTables ?? true;
  const includeNotes = options.includeNotes ?? false;
  const cellSeparator = options.cellSeparator ?? "\t";

  const lines: string[] = [];

  const emitParagraphs = (paragraphs: Paragraph[]): void => {
    for (const paragraph of paragraphs) {
      lines.push(paragraphText(paragraph, options));
      for (const run of paragraph.runs) {
        for (const item of run.items) emitNested(item);
      }
    }
  };

  const emitNested = (item: InlineItem): void => {
    switch (item.type) {
      case "table": {
        if (!includeTables) return;
        for (const row of item.rows) {
          const cells = row.cells.map((cell) =>
            cell.paragraphs.map((p) => paragraphText(p, options)).join(" "),
          );
          lines.push(cells.join(cellSeparator));
          for (const cell of row.cells) {
            for (const paragraph of cell.paragraphs) {
              for (const run of paragraph.runs) {
                for (const nested of run.items) {
                  if (nested.type === "table") emitNested(nested);
                }
              }
            }
          }
        }
        return;
      }
      case "header":
      case "footer":
      case "footnote":
      case "endnote":
        if (includeNotes) emitParagraphs(item.paragraphs);
        return;
      default:
        if ("textBox" in item && item.textBox)
          emitParagraphs(item.textBox.paragraphs);
        return;
    }
  };

  for (const section of doc.sections) emitParagraphs(section.paragraphs);

  return lines.join(separator);
}

// ---------------------------------------------------------------------------
// 편집
// ---------------------------------------------------------------------------

export interface ReplaceResult {
  /** 치환된 횟수. */
  count: number;
}

/**
 * 문서 전체에서 텍스트를 치환하되, 각 일치가 시작되는 run의 서식을 보존한다.
 *
 * 여러 run에 걸친 일치는 첫 run의 서식으로 합쳐진다. 서식이 섞인 선택 위에
 * 덧입력할 때 워드프로세서도 그렇게 한다.
 */
export function replaceText(
  doc: HwpDocument,
  search: string | RegExp,
  replacement: string | ((match: string, ...groups: string[]) => string),
): ReplaceResult {
  let count = 0;
  const pattern = toGlobalRegExp(search);

  for (const { paragraph } of walkParagraphs(doc)) {
    count += replaceInParagraph(paragraph, pattern, replacement);
  }
  return { count };
}

function toGlobalRegExp(search: string | RegExp): RegExp {
  if (typeof search === "string") {
    return new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  }
  return search.flags.includes("g")
    ? search
    : new RegExp(search.source, `${search.flags}g`);
}

function replaceInParagraph(
  paragraph: Paragraph,
  pattern: RegExp,
  replacement: string | ((match: string, ...groups: string[]) => string),
): number {
  // 문자열로 평탄화하면서 (run, item, offset)으로 되돌아가는 대응표를 함께
  // 만든다. run 경계를 넘는 일치도 위치를 찾을 수 있도록.
  const pieces: { run: Run; itemIndex: number; start: number; end: number }[] =
    [];
  let text = "";
  for (const run of paragraph.runs) {
    for (let i = 0; i < run.items.length; i++) {
      const item = run.items[i]!;
      if (item.type !== "text") continue;
      pieces.push({
        run,
        itemIndex: i,
        start: text.length,
        end: text.length + item.value.length,
      });
      text += item.value;
    }
  }
  if (text.length === 0) return 0;

  pattern.lastIndex = 0;
  const matches: { start: number; end: number; value: string }[] = [];
  for (
    let match = pattern.exec(text);
    match !== null;
    match = pattern.exec(text)
  ) {
    const value =
      typeof replacement === "string"
        ? expandReplacement(replacement, match)
        : replacement(match[0], ...match.slice(1));
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      value,
    });
    if (match[0].length === 0) pattern.lastIndex++;
  }
  if (matches.length === 0) return 0;

  // 앞쪽 오프셋이 유효하게 남도록 뒤에서부터 적용한다.
  for (let m = matches.length - 1; m >= 0; m--) {
    const { start, end, value } = matches[m]!;
    const touched = pieces.filter((p) => p.end > start && p.start < end);
    if (touched.length === 0) continue;

    const first = touched[0]!;
    const firstItem = first.run.items[first.itemIndex]!;
    if (firstItem.type !== "text") continue;

    const head = firstItem.value.slice(0, start - first.start);
    const last = touched[touched.length - 1]!;
    const lastItem = last.run.items[last.itemIndex]!;
    const tail =
      lastItem.type === "text" ? lastItem.value.slice(end - last.start) : "";

    firstItem.value = head + value + (touched.length === 1 ? tail : "");

    for (let t = 1; t < touched.length; t++) {
      const piece = touched[t]!;
      const item = piece.run.items[piece.itemIndex]!;
      if (item.type !== "text") continue;
      item.value = t === touched.length - 1 ? tail : "";
    }

    // 방금 다시 쓴 조각의 오프셋은 낡았지만, 일치를 뒤에서부터 훑기 때문에
    // 다시 참조되는 건 앞쪽 조각뿐이고 그것들은 손대지 않았다.
  }

  return matches.length;
}

function expandReplacement(
  replacement: string,
  match: RegExpExecArray,
): string {
  return replacement.replace(/\$(\d+|&|\$)/g, (_, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return match[0];
    return match[Number(token)] ?? "";
  });
}

/** 텍스트가 일치하는 모든 문단을 찾는다. */
export function findParagraphs(
  doc: HwpDocument,
  search: string | RegExp,
): ParagraphLocation[] {
  const pattern = toGlobalRegExp(search);
  const out: ParagraphLocation[] = [];
  for (const location of walkParagraphs(doc)) {
    pattern.lastIndex = 0;
    if (pattern.test(paragraphText(location.paragraph))) out.push(location);
  }
  return out;
}

/** 문서의 모든 표를 읽기 순서로. */
export function tables(
  doc: HwpDocument,
): Extract<Control, { type: "table" }>[] {
  const out: Extract<Control, { type: "table" }>[] = [];
  for (const control of walkControls(doc)) {
    if (control.type === "table") out.push(control);
  }
  return out;
}

/** 표를 문자열 2차원 배열로 읽는다. */
export function tableToArray(
  table: Extract<Control, { type: "table" }>,
): string[][] {
  return table.rows.map((row) =>
    row.cells.map((cell: TableCell) =>
      cell.paragraphs.map((p) => paragraphText(p)).join("\n"),
    ),
  );
}

/** 문서의 모든 이미지를 바이트와 짝지어서. */
export function images(
  doc: HwpDocument,
): { extension: string; data: Uint8Array }[] {
  const out: { extension: string; data: Uint8Array }[] = [];
  for (const control of walkControls(doc)) {
    if (control.type !== "picture") continue;
    const item = doc.binData[control.binDataId];
    if (item?.data)
      out.push({ extension: item.extension ?? "", data: item.data });
  }
  return out;
}

/** 상태 표시줄이 하듯 낱말, 글자, 문단 수를 센다. */
export function statistics(doc: HwpDocument): {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  paragraphs: number;
  pages: number;
  tables: number;
  images: number;
} {
  let characters = 0;
  let charactersNoSpaces = 0;
  let words = 0;
  let paragraphs = 0;

  for (const { paragraph } of walkParagraphs(doc)) {
    const text = paragraphText(paragraph);
    paragraphs++;
    characters += text.length;
    charactersNoSpaces += text.replace(/\s/g, "").length;
    const matched = text.match(/\S+/g);
    words += matched ? matched.length : 0;
  }

  let tableCount = 0;
  let imageCount = 0;
  for (const control of walkControls(doc)) {
    if (control.type === "table") tableCount++;
    if (control.type === "picture") imageCount++;
  }

  return {
    characters,
    charactersNoSpaces,
    words,
    paragraphs,
    pages: doc.sections.length,
    tables: tableCount,
    images: imageCount,
  };
}

/** 문서에 구역을 덧붙이고 그것을 반환한다. */
export function addSection(doc: HwpDocument, section: Section): Section {
  doc.sections.push(section);
  return section;
}
