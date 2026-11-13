/**
 * `.hwp` 두 판 사이에서 바뀐 바이트와 비트를 찾는다.
 *
 * 레코드 스트림(DocInfo, BodyText/Section*)은 압축을 풀고 레코드로 나눠서
 * 레코드끼리 맞춘다. 나머지 스트림(FileHeader, BinData, 요약 정보 등)은 원시
 * 바이트로 비교한다. 해석은 하지 않는다. 오프셋과 비트만 보여준다.
 */

import {
  maybeInflate,
  parseFileHeader,
  parseRecords,
  tagName,
  type HwpRecord,
} from "@js-hwp/hwp";
import { read as readCfb } from "cfb";

export type Stream =
  | { kind: "records"; records: HwpRecord[] }
  | { kind: "raw"; bytes: Uint8Array };

export type Snapshot = Map<string, Stream>;

const isRecordStream = (path: string): boolean =>
  path === "DocInfo" || /^BodyText\//i.test(path);

export function snapshot(data: Uint8Array): Snapshot {
  const container = readCfb(data, { type: "array" });
  const root = container.FullPaths[0] ?? "";
  const raw = new Map<string, Uint8Array>();
  container.FileIndex.forEach((entry, i) => {
    if (entry.type !== 2) return; // 스트림만
    const path = (container.FullPaths[i] ?? "").slice(root.length);
    const content = entry.content as ArrayLike<number> | undefined;
    raw.set(path, content ? Uint8Array.from(content) : new Uint8Array(0));
  });

  const header = raw.get("FileHeader");
  const compressed = header ? parseFileHeader(header).flags.compressed : false;

  const out: Snapshot = new Map();
  for (const [path, bytes] of [...raw].sort(([a], [b]) => a.localeCompare(b))) {
    if (isRecordStream(path)) {
      try {
        out.set(path, {
          kind: "records",
          records: parseRecords(maybeInflate(bytes, compressed)),
        });
        continue;
      } catch {
        // 풀리지 않으면 원시 바이트로 본다.
      }
    }
    out.set(path, { kind: "raw", bytes });
  }
  return out;
}

const hex = (n: number, w = 2): string =>
  n.toString(16).toUpperCase().padStart(w, "0");
const bin = (n: number): string => n.toString(2).padStart(8, "0");
const MAX_BYTES = 32;

/** 같은 길이 구간에서 바뀐 바이트를 한 줄씩. 켜진 비트 ↑, 꺼진 비트 ↓. */
export function byteLines(
  a: Uint8Array,
  b: Uint8Array,
  indent = "    ",
): string[] {
  const lines: string[] = [];
  let changed = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    if (++changed > MAX_BYTES) continue;
    const bits: string[] = [];
    for (let k = 0; k < 8; k++) {
      const m = 1 << k;
      if ((x ^ y) & m) bits.push(`${k}${y & m ? "↑" : "↓"}`);
    }
    lines.push(
      `${indent}+0x${hex(i, 4)}  ${hex(x)}→${hex(y)}  ${bin(x)}→${bin(y)}  bit ${bits.join(" ")}`,
    );
  }
  if (changed > MAX_BYTES)
    lines.push(`${indent}… 바이트 ${changed - MAX_BYTES}개 더`);
  if (a.length !== b.length)
    lines.push(`${indent}길이 ${a.length} → ${b.length}`);
  return lines;
}

const recEq = (x: HwpRecord, y: HwpRecord): boolean =>
  x.tagId === y.tagId &&
  x.level === y.level &&
  x.payload.length === y.payload.length &&
  x.payload.every((v, i) => v === y.payload[i]);

function recordLines(stream: string, a: HwpRecord[], b: HwpRecord[]): string[] {
  const kind = stream === "DocInfo" ? "docinfo" : "section";
  const label = (r: HwpRecord, i: number): string =>
    `#${i} ${tagName(r.tagId, kind)} (lv${r.level}, ${r.payload.length}B)`;

  // ponytail: 앞뒤 공통 레코드만 잘라내고 가운데는 인덱스로 맞춘다. 가운데에 삽입이
  // 섞이면 뒤가 밀려 보인다. 그게 시끄러우면 레코드 LCS로 바꾼다.
  let start = 0;
  while (start < a.length && start < b.length && recEq(a[start]!, b[start]!))
    start++;
  let ea = a.length;
  let eb = b.length;
  while (ea > start && eb > start && recEq(a[ea - 1]!, b[eb - 1]!))
    (ea--, eb--);

  const lines: string[] = [];
  if (a.length !== b.length) lines.push(`  레코드 ${a.length} → ${b.length}`);
  for (let k = 0; start + k < ea || start + k < eb; k++) {
    const x = start + k < ea ? a[start + k] : undefined;
    const y = start + k < eb ? b[start + k] : undefined;
    // 바뀐 두 레코드 사이에 낀 같은 레코드는 보여줄 게 없다.
    if (x && y && recEq(x, y)) continue;
    if (x && y && x.tagId === y.tagId) {
      lines.push(
        `  ${label(y, start + k)}${x.level !== y.level ? ` level ${x.level}→${y.level}` : ""}`,
      );
      lines.push(...byteLines(x.payload, y.payload));
      continue;
    }
    if (x) lines.push(`  - ${label(x, start + k)}`);
    if (y) lines.push(`  + ${label(y, start + k)}`);
  }
  return lines;
}

/** 바뀐 것이 없으면 빈 배열. */
export function diffSnapshots(prev: Snapshot, next: Snapshot): string[] {
  const out: string[] = [];
  for (const path of new Set([...prev.keys(), ...next.keys()])) {
    const a = prev.get(path);
    const b = next.get(path);
    const name = JSON.stringify(path).slice(1, -1); // 요약 정보 스트림 이름의 제어 문자
    if (!a || !b) {
      out.push(`${b ? "+" : "-"} ${name}`);
      continue;
    }
    const lines =
      a.kind === "records" && b.kind === "records"
        ? recordLines(path, a.records, b.records)
        : a.kind === "raw" && b.kind === "raw"
          ? byteLines(a.bytes, b.bytes, "  ")
          : ["  (레코드 스트림 ↔ 원시 스트림)"];
    if (lines.length) out.push(name, ...lines);
  }
  return out;
}
