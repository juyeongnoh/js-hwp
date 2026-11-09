# js-hwp

"본 제품은 한글과컴퓨터의
한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다."

```bash
npm install js-hwp
```

## 문서 만들기

```ts
import { writeFile } from "node:fs/promises";
import { DocumentBuilder, save } from "js-hwp";

const doc = new DocumentBuilder()
  .meta({ title: "분기 보고서", author: "홍길동" })
  .page({ paper: "A4", margins: { left: "30mm", right: "30mm" } })
  .heading(1, "개요")
  .paragraph("올해 3분기 실적을 정리한 문서입니다.")
  .paragraph((p) =>
    p.text("매출은 ").bold("전년 대비 12% 증가").text("했습니다."),
  )
  .heading(2, "항목별 실적")
  .table(
    [
      ["항목", "금액"],
      ["매출", "1,200"],
      ["영업이익", "180"],
    ],
    { header: true },
  )
  .build();

await writeFile("report.hwp", save(doc, "hwp"));
```

## 문서 읽고 고치기

```ts
import { readFile, writeFile } from "node:fs/promises";
import {
  open,
  save,
  replaceText,
  documentText,
  tables,
  tableToArray,
} from "js-hwp";

const doc = open(new Uint8Array(await readFile("template.hwp")));

replaceText(doc, "{{날짜}}", "2026년 8월 4일");
replaceText(doc, /고객명/g, "한국전자");

console.log(documentText(doc));
console.log(tableToArray(tables(doc)[0]));

await writeFile("filled.hwp", save(doc, "hwp"));
```

## 캐럿 위치에서 편집하기

```ts
import {
  open,
  position,
  insertText,
  formatText,
  splitParagraph,
  History,
} from "js-hwp";

const history = new History();
history.record(doc);

insertText(doc, position(0, 0, 0), "머리말: ");
formatText(
  doc,
  { start: position(0, 0, 0), end: position(0, 0, 4) },
  { bold: true, color: "#c00000", size: 14 },
);
splitParagraph(doc, position(0, 0, 4));

const previous = history.undo(doc);
```
