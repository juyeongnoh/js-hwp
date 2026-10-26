# js-hwp

"본 제품은 한글과컴퓨터의
한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다."

TypeScript 기반 HWP 라이브러리
두 파일 포맷 모두 양방향을 지원한다.

|                                                 | 읽기 | 쓰기 |
| ----------------------------------------------- | ---- | ---- |
| **`.hwp`** — HWP 5.x, OLE2 바이너리 포맷        | ✅   | ✅   |
| **`.hwpx`** — OWPML (KS X 6101), ZIP + XML 포맷 | ✅   | ✅   |

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

await writeFile("report.hwpx", save(doc, "hwpx"));
await writeFile("report.hwp", save(doc, "hwp"));
```

## 문서 읽고 고치기

`open()`은 파일 이름이 아니라 바이트를 본다. 그래서 확장자가 잘못 붙은 파일도
열린다.

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

`.hwp`를 읽어서 `.hwpx`로 쓰는 것(또는 그 반대)은 `save()`에 어떤 포맷을
넘기느냐의 문제일 뿐이다. `convert()`가 한 줄짜리 버전이다.

## 캐럿 위치에서 편집하기

워드프로세서가 쓰는 것과 똑같은 연산이 라이브러리에 들어 있다. 그래서 스크립트로
하는 편집과 대화형 편집이 하나의 코드 경로를 지난다.

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

위치는 문단 하나에 문자 오프셋을 더한 것이고, 표·이미지·탭은 각각 정확히 한
글자로 센다. 바이너리 포맷이 이것들을 문단 텍스트 안의 제어 문자로 저장하는
방식과 같다.

## 렌더링

```ts
import { renderToHtml, renderToMarkdown, exportPdf } from "js-hwp";

const html = renderToHtml(doc); // 페이지 단위 HTML, 실제 페이지 지오메트리
const markdown = renderToMarkdown(doc); // 손실은 있지만 diff 가능
const pdf = await exportPdf(doc); // Playwright 또는 Electron 창 필요
```

PDF 내보내기는 실제 브라우저 엔진에 문서를 배치하고 인쇄한다. 의도한 것이다.
크로미움의 줄바꿈 처리, 폰트 셰이핑, 페이지 분할은 직접 구현해서 낼 수 있는
어떤 결과보다 낫고, Electron 앱은 이미 그걸 하나 품고 있다.

## 명령줄

```
npm install -g @js-hwp/cli

js-hwp text     report.hwp              # 일반 텍스트
js-hwp info     report.hwp              # 포맷, 버전, 글꼴, 스타일, 개수
js-hwp tables   report.hwp              # 모든 표를 TSV로
js-hwp markdown report.hwp -o report.md
js-hwp html     report.hwp -o report.html
js-hwp convert  report.hwp -o report.hwpx
js-hwp replace  template.hwp -o out.hwp '{{날짜}}' '2026-08-04'
```

## HWP 5 개발을 처음 시작한다면

[한컴의 HWP 5.0 파일 형식 명세서(개정 1.3)](https://cdn.hancom.com/link/docs/%ED%95%9C%EA%B8%80%EB%AC%B8%EC%84%9C%ED%8C%8C%EC%9D%BC%ED%98%95%EC%8B%9D_5.0_revision1.3.pdf)를
옆에 두고 아래 순서대로 같은 구조의 코드를 읽으면 된다.

| 순서 | 명세서에서 볼 것 | 이 저장소에서 볼 것 |
| --- | --- | --- |
| 1 | 3장 파일 구조, `FileHeader`, `DocInfo`, `BodyText` 스트림 | `packages/hwp/src/document.ts`, `fileheader.ts`, `compress.ts` |
| 2 | 4.1절 레코드 헤더의 태그·레벨·크기 | `packages/hwp/src/record.ts`, `tags.ts`, `bytes.ts` |
| 3 | 4.2절 문서 정보의 글꼴·글자 모양·문단 모양·테두리 | `packages/hwp/src/docinfo.ts`, `packages/core/src/model/docinfo.ts` |
| 4 | 4.3절 본문의 문단·문자·컨트롤·표 | `packages/hwp/src/bodytext.ts`, `packages/core/src/model/controls.ts` |
| 5 | 고수준 API에서 저장까지의 연결 | `packages/core/src/builder.ts` → `packages/js-hwp/src/index.ts` → `packages/hwp/src/document.ts` |

가장 작은 실습은 `new DocumentBuilder().paragraph("안녕하세요").build()`를
`save(doc, "hwp")`로 저장하고, `BodyText/Section0`를 `parseRecords()`로 읽어
`ParaHeader`·`ParaText`의 태그, 레벨, 바이트 길이를 명세서와 비교하는 것이다.
그다음 한글에서 같은 문서를 열어 본다. 라이브러리의 자체 왕복 테스트만으로는
한글 호환성을 증명할 수 없기 때문이다.
