import {
  parseColor,
  Align,
  BinDataType,
  DocumentBuilder,
  PAPER,
  documentText,
  mm,
  paragraphText,
  pt,
  tableToArray,
  tables,
} from "@js-hwp/core";
import {
  find as findCfb,
  read as readCfb,
  utils as cfbUtils,
  write as writeCfb,
} from "cfb";
import { describe, expect, it } from "vitest";
import {
  CONTROL_FORM,
  isHwp,
  parseHwp,
  readCtrlId,
  serializeHwp,
  writeCtrlId,
} from "../src/index.js";
import { writeFileSync } from "node:fs";

const roundTrip = (doc: ReturnType<DocumentBuilder["build"]>) =>
  parseHwp(serializeHwp(doc));

describe("컨테이너 구조", () => {
  const doc = new DocumentBuilder().paragraph("안녕하세요").build();
  const container = readCfb(serializeHwp(doc), { type: "array" });

  it("한글에서 요구하는 스트림을 기록한다", () => {
    for (const path of ["FileHeader", "DocInfo", "BodyText/Section0"]) {
      expect(findCfb(container, `/${path}`), path).not.toBeNull();
    }
  });

  it("HWP 문서로 인식된다", () => {
    expect(isHwp(serializeHwp(doc))).toBe(true);
    expect(isHwp(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe(false);
    expect(isHwp(new Uint8Array(4))).toBe(false);
  });

  it("구역마다 BodyText 스트림을 하나씩 기록한다", () => {
    const multi = new DocumentBuilder()
      .paragraph("a")
      .section()
      .paragraph("b")
      .build();
    const files = readCfb(serializeHwp(multi), { type: "array" });
    expect(findCfb(files, "/BodyText/Section0")).not.toBeNull();
    expect(findCfb(files, "/BodyText/Section1")).not.toBeNull();
  });

  it("압축하지 않은 스트림을 기록할 수 있다", () => {
    const uncompressed = serializeHwp(doc, { compress: false });
    expect(documentText(parseHwp(uncompressed))).toBe("안녕하세요");
    // DocInfo는 원시 레코드로 읽혀야 한다. 즉 deflate 출력이 아니어야 한다.
    const stream = findCfb(
      readCfb(uncompressed, { type: "array" }),
      "/DocInfo",
    )?.content;
    expect(stream?.length).toBeGreaterThan(0);
  });
});

describe("컨트롤 ID", () => {
  it("네 글자를 올바른 순서로 읽는다", () => {
    // 디스크에서 DWORD는 이름을 거꾸로 적는다.
    expect(readCtrlId(writeCtrlId("tbl "))).toBe("tbl ");
    expect(readCtrlId(writeCtrlId("secd"))).toBe("secd");
    expect(readCtrlId(writeCtrlId("gso "))).toBe("gso ");
  });

  it("짧은 ID를 네 글자가 되도록 패딩한다", () => {
    expect(readCtrlId(writeCtrlId("fn"))).toBe("fn  ");
  });
});

describe("제어 문자 형식", () => {
  it("0부터 31까지의 모든 코드를 분류한다", () => {
    expect(CONTROL_FORM).toHaveLength(32);
  });

  it("명세 요약과 일치한다", () => {
    const chars = [0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31];
    const inline = [4, 5, 6, 7, 8, 9, 19, 20];
    const extended = [1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23];

    for (const code of chars)
      expect(CONTROL_FORM[code], `code ${code}`).toBe("char");
    for (const code of inline)
      expect(CONTROL_FORM[code], `code ${code}`).toBe("inline");
    for (const code of extended)
      expect(CONTROL_FORM[code], `code ${code}`).toBe("extended");
    expect(chars.length + inline.length + extended.length).toBe(32);
  });
});

describe("직렬화 후 다시 파싱", () => {
  it("일반 텍스트를 보존한다", () => {
    expect(
      documentText(
        roundTrip(new DocumentBuilder().paragraph("안녕하세요").build()),
      ),
    ).toBe("안녕하세요");
  });

  it("여러 문단을 보존한다", () => {
    const doc = new DocumentBuilder()
      .paragraph("첫째")
      .paragraph("둘째")
      .paragraph("셋째")
      .build();
    expect(documentText(roundTrip(doc))).toBe("첫째\n둘째\n셋째");
  });

  it("레코드 크기 확장 기준을 넘는 긴 문단을 보존한다", () => {
    const long = "가".repeat(5000);
    expect(
      documentText(roundTrip(new DocumentBuilder().paragraph(long).build())),
    ).toBe(long);
  });

  it("글자 서식과 텍스트 런 경계를 보존한다", () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.text("평문").bold("굵게").text("평문2"))
      .build();
    const back = roundTrip(doc);
    const runs = back.sections[0]!.paragraphs[0]!.runs;

    expect(documentText(back)).toBe("평문굵게평문2");
    expect(runs).toHaveLength(3);
    expect(back.charShapes[runs[1]!.charShapeId]!.bold).toBe(true);
    expect(back.charShapes[runs[0]!.charShapeId]!.bold).toBeFalsy();
    expect(back.charShapes[runs[2]!.charShapeId]!.bold).toBeFalsy();
  });

  it("글자 색상과 크기를 보존한다", () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.text("빨강", { color: "#ff0000", size: 14 }))
      .build();
    const back = roundTrip(doc);
    const shape =
      back.charShapes[back.sections[0]!.paragraphs[0]!.runs[0]!.charShapeId]!;
    expect(shape.textColor).toEqual(parseColor(0xff0000));
    expect(shape.height).toBe(pt(14));
  });

  it("취소선이 없는 곳에 취소선을 추가하지 않는다", () => {
    const doc = new DocumentBuilder().paragraph("평범한 글").build();
    const back = roundTrip(doc);
    expect(
      back.charShapes[back.sections[0]!.paragraphs[0]!.runs[0]!.charShapeId]!
        .strikeout.enabled,
    ).toBe(false);
  });

  it("설정된 취소선을 보존한다", () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.strike("지움"))
      .build();
    const back = roundTrip(doc);
    expect(
      back.charShapes[back.sections[0]!.paragraphs[0]!.runs[0]!.charShapeId]!
        .strikeout.enabled,
    ).toBe(true);
  });

  it("밑줄을 보존한다", () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.underline("밑줄"))
      .build();
    const back = roundTrip(doc);
    expect(
      back.charShapes[back.sections[0]!.paragraphs[0]!.runs[0]!.charShapeId]!
        .underline.kind,
    ).toBe(1);
  });

  it("문단 서식을 보존한다", () => {
    const doc = new DocumentBuilder()
      .paragraph("가운데", {
        align: "center",
        lineHeight: 200,
        marginLeft: 20,
        indent: -10,
      })
      .build();
    const back = roundTrip(doc);
    const shape =
      back.paraShapes[back.sections[0]!.paragraphs[0]!.paraShapeId]!;
    expect(shape.align).toBe(Align.Center);
    expect(shape.lineSpacing.value).toBe(200);
    expect(shape.marginLeft).toBe(4000);
    expect(shape.indent).toBe(-2000);
  });

  it("글꼴을 보존한다", () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.text("가", { font: "나눔고딕" }))
      .build();
    const back = roundTrip(doc);
    const shape =
      back.charShapes[back.sections[0]!.paragraphs[0]!.runs[0]!.charShapeId]!;
    shape.fontIds.forEach((id, lang) =>
      expect(back.fonts[lang][id]!.name).toBe("나눔고딕"),
    );
  });

  it("스타일을 보존한다", () => {
    const doc = new DocumentBuilder()
      .heading(1, "제목")
      .paragraph("본문")
      .build();
    const back = roundTrip(doc);
    expect(back.styles[0]!.name).toBe("바탕글");
    expect(back.styles.map((s) => s.name)).toContain("개요 1");
  });

  it("쪽 설정을 보존한다", () => {
    const doc = new DocumentBuilder()
      .page({ paper: "A4", landscape: true, margins: { left: mm(25) } })
      .paragraph("x")
      .build();
    const back = roundTrip(doc).sections[0]!.pageDef;
    expect(back.width).toBe(PAPER.A4.width);
    expect(back.landscape).toBe(true);
    expect(back.margins.left).toBe(mm(25));
  });

  it("탭과 줄바꿈 및 특수 문자를 보존한다", () => {
    const doc = new DocumentBuilder()
      .paragraph((p) =>
        p.text("a").tab().text("b").lineBreak().text("c").nbsp().text("d"),
      )
      .build();
    const items = roundTrip(doc).sections[0]!.paragraphs[0]!.runs.flatMap(
      (r) => r.items,
    );
    expect(items.map((i) => i.type)).toEqual([
      "text",
      "tab",
      "text",
      "lineBreak",
      "text",
      "specialChar",
      "text",
    ]);
  });

  it("표와 셀 텍스트를 보존한다", () => {
    const doc = new DocumentBuilder()
      .table([
        ["이름", "부서"],
        ["홍길동", "개발"],
      ])
      .build();
    const back = roundTrip(doc);
    const table = tables(back)[0];
    expect(table).toBeDefined();
    expect(tableToArray(table!)).toEqual([
      ["이름", "부서"],
      ["홍길동", "개발"],
    ]);
  });

  it("각주를 보존한다", () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.text("본문").footnote("각주"))
      .build();
    const items = roundTrip(doc).sections[0]!.paragraphs[0]!.runs.flatMap(
      (r) => r.items,
    );
    const note = items.find((i) => i.type === "footnote");
    expect(
      note?.type === "footnote" && paragraphText(note.paragraphs[0]!),
    ).toBe("각주");
  });

  it("머리말을 보존한다", () => {
    const doc = new DocumentBuilder()
      .header("머리말")
      .paragraph("본문")
      .build();
    const items = roundTrip(doc).sections[0]!.paragraphs[0]!.runs.flatMap(
      (r) => r.items,
    );
    const header = items.find((i) => i.type === "header");
    expect(
      header?.type === "header" && paragraphText(header.paragraphs[0]!),
    ).toBe("머리말");
  });

  it("책갈피를 보존한다", () => {
    const doc = new DocumentBuilder()
      .paragraph((p) => p.bookmark("여기").text("x"))
      .build();
    const items = roundTrip(doc).sections[0]!.paragraphs[0]!.runs.flatMap(
      (r) => r.items,
    );
    const bookmark = items.find((i) => i.type === "bookmark");
    expect(bookmark?.type === "bookmark" && bookmark.name).toBe("여기");
  });

  it("삽입된 이미지를 보존한다", () => {
    const png = makePng(100, 50);
    const doc = new DocumentBuilder().image(png, { width: mm(40) }).build();
    const back = roundTrip(doc);
    expect(back.binData.length).toBeGreaterThan(0);
    expect([...back.binData[0]!.data!]).toEqual([...png]);
  });

  it("여러 구역을 보존한다", () => {
    const doc = new DocumentBuilder()
      .paragraph("첫 구역")
      .section()
      .paragraph("둘째 구역")
      .build();
    const back = roundTrip(doc);
    expect(back.sections).toHaveLength(2);
    expect(documentText(back)).toBe("첫 구역\n둘째 구역");
  });

  it("지정된 문서 버전을 보존한다", () => {
    const doc = new DocumentBuilder().paragraph("x").build();
    doc.version = { major: 5, minor: 0, build: 3, revision: 0 };
    expect(roundTrip(doc).version).toEqual({
      major: 5,
      minor: 0,
      build: 3,
      revision: 0,
    });
  });

  it("두 번째 직렬화 후 다시 파싱해도 변경되지 않는다", () => {
    const doc = new DocumentBuilder()
      .heading(1, "제목")
      .paragraph((p) => p.text("평문").bold("굵게"))
      .table([["a", "b"]])
      .build();
    const once = parseHwp(serializeHwp(doc));
    const twice = parseHwp(serializeHwp(once));
    expect(documentText(twice)).toBe(documentText(once));
    expect(twice.charShapes.length).toBe(once.charShapes.length);
  });
});

describe("보호된 문서", () => {
  it("암호로 보호된 파일을 지원하지 않는다고 안내한다", () => {
    const doc = new DocumentBuilder().paragraph("x").build();
    const bytes = serializeHwp(doc);
    // FileHeader 스트림 안의 암호 비트를 뒤집는다.
    const patched = patchFileHeaderFlag(bytes, 1);
    expect(() => parseHwp(patched)).toThrow(/암호로 보호된 문서/);
  });

  it("배포용 문서를 지원하지 않는다고 안내한다", () => {
    const doc = new DocumentBuilder().paragraph("x").build();
    const patched = patchFileHeaderFlag(serializeHwp(doc), 2);
    expect(() => parseHwp(patched)).toThrow(/배포용 문서/);
  });

  it("엄격한 검사를 끄면 파싱을 시도할 수 있다", () => {
    const doc = new DocumentBuilder().paragraph("x").build();
    const patched = patchFileHeaderFlag(serializeHwp(doc), 2);
    expect(() => parseHwp(patched, { strict: false })).not.toThrow();
  });
});

describe("스트림 이름의 대소문자가 다른 경우", () => {
  /** 모든 스트림 경로를 소문자로 바꿔 컨테이너를 다시 만든다. */
  const downcase = (file: Uint8Array): Uint8Array => {
    const source = readCfb(file, { type: "array" });
    const target = cfbUtils.cfb_new();
    for (const [index, entry] of source.FileIndex.entries()) {
      if (entry.type !== 2) continue;
      const path = source.FullPaths[index]!.slice(source.FullPaths[0]!.length);
      cfbUtils.cfb_add(
        target,
        path.toLowerCase(),
        entry.content ?? new Uint8Array(0),
      );
    }
    return new Uint8Array(writeCfb(target));
  };

  const original = new DocumentBuilder()
    .paragraph("구역 본문")
    .image(makePng(10, 10), { width: mm(20) })
    .build();

  it("저장소 이름이 bindata와 bodytext인 문서를 읽는다", () => {
    const file = downcase(serializeHwp(original));
    const container = readCfb(file, { type: "array" });
    expect(container.FullPaths).toContain(
      `${container.FullPaths[0]}bodytext/section0`,
    );
    const back = parseHwp(file);
    // 이미지가 자기 문단에 있어서 뒤에 나눔이 붙는다.
    expect(documentText(back)).toBe("구역 본문\n");
    expect(back.binData[0]?.data).toBeDefined();
    expect(isHwp(file)).toBe(true);
  });

  it("대소문자만 다른 동일한 스트림을 중복 보존하지 않는다", () => {
    const rewritten = serializeHwp(parseHwp(downcase(serializeHwp(original))));
    const container = readCfb(rewritten, { type: "array" });
    const paths = container.FullPaths.filter(
      (_, index) => container.FileIndex[index]?.type === 2,
    ).map((path) => path.slice(container.FullPaths[0]!.length).toLowerCase());
    expect(paths.length, `duplicate streams in ${paths.join(", ")}`).toBe(
      new Set(paths).size,
    );
  });
});

/** FileHeader 스트림 속성 1의 비트를 제자리에서 설정한다. */
function patchFileHeaderFlag(bytes: Uint8Array, bitIndex: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  // 스트림이 작아서 미니 스트림에 산다. 시그니처로 찾는다.
  const needle = new TextEncoder().encode("HWP Document File");
  for (let i = 0; i + needle.length < copy.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (copy[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
    const offset = i + 36;
    view.setUint32(
      offset,
      view.getUint32(offset, true) | (1 << bitIndex),
      true,
    );
    return copy;
  }
  throw new Error("FileHeader 시그니처를 찾을 수 없습니다.");
}

function makePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}


describe("BinData 확장자", () => {
  it.each(["", undefined, "png"])("확장자 %s를 스트림 이름과 DocInfo에 일관되게 기록한다", (extension) => {
    const doc = new DocumentBuilder().paragraph("이미지").build();
    const data = new Uint8Array([1, 2, 3]);
    doc.binData.push({ type: BinDataType.Embedding, extension, data });
    const bytes = serializeHwp(doc, { compress: false });
    const container = readCfb(bytes, { type: "array" });
    const name = extension ? `BIN0001.${extension}` : "BIN0001";
    expect(Array.from(findCfb(container, `/BinData/${name}`)!.content)).toEqual([...data]);
    const back = parseHwp(bytes);
    expect(back.binData[0]?.extension).toBe(extension ?? "");
    expect(back.binData[0]?.data).toEqual(data);
  });
});

describe("표·셀 테두리 참조", () => {
  it("저장하고 다시 읽어도 표와 셀의 테두리 인덱스가 그대로다", () => {
    const doc = new DocumentBuilder()
      .table([["가", "나"]], { borderFillId: 0 })
      .build();
    const table = tables(doc)[0]!;
    delete table.rows[0]!.cells[1]!.borderFillId;
    const reread = tables(parseHwp(serializeHwp(doc)))[0]!;
    expect(reread.borderFillId).toBe(0);
    expect(reread.rows[0]!.cells[0]!.borderFillId).toBe(table.rows[0]!.cells[0]!.borderFillId);
    expect(reread.rows[0]!.cells[1]!.borderFillId).toBeUndefined();
  });
});
