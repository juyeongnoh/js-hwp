#!/usr/bin/env node
/**
 * hwp-watch <file.hwp>
 *
 * 파일을 지켜보다가 바뀔 때마다 직전 판과 비교해 바뀐 레코드·바이트·비트를 출력한다.
 * 한글에서 값을 하나씩 바꿔 저장하면서 그 값이 어느 비트에 사는지 보는 용도.
 */

import { readFileSync, watchFile } from "node:fs";
import { parseArgs } from "node:util";
import { diffSnapshots, snapshot, type Snapshot } from "./diff.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    only: { type: "string", multiple: true },
    skip: { type: "string", multiple: true },
  },
});
const file = positionals[0];
if (!file) {
  console.error(
    "사용법: hwp-watch <file.hwp> [--only DocInfo,BodyText] [--skip PrvImage,PrvText]",
  );
  console.error("  스트림 경로 앞부분으로 맞춘다. 대소문자 무시. 쉼표로 여럿.");
  process.exit(1);
}

const list = (v?: string[]): string[] =>
  (v ?? [])
    .flatMap((s) => s.split(","))
    .filter(Boolean)
    .map((s) => s.toLowerCase());
const only = list(values.only);
const skip = list(values.skip);
const match = (path: string, prefixes: string[]): boolean =>
  // `\u0005HwpSummaryInformation`처럼 제어 문자로 시작하는 이름은 그걸 떼고 맞춘다.
  prefixes.some((p) =>
    path
      .replace(/^[\x00-\x1f]+/, "")
      .toLowerCase()
      .startsWith(p),
  );
const keep = (path: string): boolean =>
  (!only.length || match(path, only)) && !match(path, skip);

const load = (): Snapshot =>
  new Map(
    [...snapshot(new Uint8Array(readFileSync(file)))].filter(([path]) =>
      keep(path),
    ),
  );

let prev = load();
const count = [...prev.values()].reduce(
  (n, s) => n + (s.kind === "records" ? s.records.length : 0),
  0,
);
console.log(`${file} 지켜보는 중 — 스트림 ${prev.size}개, 레코드 ${count}개`);
console.log(
  `  ${[...prev.keys()].map((p) => JSON.stringify(p).slice(1, -1)).join(", ")}`,
);

// 한글은 저장할 때 파일을 바꿔치기할 수 있어서 fs.watch 대신 stat 폴링을 쓴다.
watchFile(file, { interval: 300 }, (cur, old) => {
  if (cur.mtimeMs === old.mtimeMs && cur.size === old.size) return;
  let next: Snapshot;
  try {
    next = load();
  } catch (e) {
    // 쓰는 도중에 읽었을 수 있다. 다음 변경에서 다시 본다.
    console.log(
      `[${new Date().toLocaleTimeString()}] 읽기 실패: ${(e as Error).message}`,
    );
    return;
  }
  const lines = diffSnapshots(prev, next);
  console.log(
    `\n[${new Date().toLocaleTimeString()}] ${lines.length ? "" : "바뀐 바이트 없음"}`,
  );
  for (const line of lines) console.log(line);
  prev = next;
});
