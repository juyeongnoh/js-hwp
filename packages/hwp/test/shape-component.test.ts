import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ArcKind,
  ArrowSize,
  ArrowStyle,
  HatchStyle,
  LineEndCap,
  LineStyle,
  OutlineStyle,
  ShapeShadowKind,
  type Control,
  type Fill,
  type ShapeComponent,
  type RectangleControl,
  type LineControl,
  type EllipseControl,
  type ArcControl,
  type PolygonControl,
  type CurveControl,
  type ShapeLine,
  type PictureControl,
} from "@js-hwp/core";
import CFB from "cfb";
import { describe, expect, it } from "vitest";
import {
  readArcShape,
  readCurveShape,
  readEllipseShape,
  readLineShape,
  readPolygonShape,
  readShapeComponent,
  readShapeRectangle,
  writeCurveShape,
  writeLineShape,
  writePolygonShape,
  writeShapeComponent,
  writeShapeRectangle,
} from "../src/bodytext.js";
import { maybeInflate } from "../src/compress.js";
import { parseHwp, serializeHwp } from "../src/document.js";
import {
  buildRecordTree,
  parseRecords,
  type RecordNode,
} from "../src/record.js";
import { SectionTag } from "../src/tags.js";

const root = join(__dirname, "../../..");
const files = ["docs/experiments", "fixtures", "scratch"].flatMap((d) =>
  readdirSync(join(root, d), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".hwp"))
    .map((f) => join(root, d, f)),
);

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

/** 모든 SHAPE_COMPONENT 페이로드(16진수)를 나온 순서대로. */
function shapeComponents(bytes: Uint8Array): string[] {
  return shapeComponentsWithIdCount(bytes).map(([payload]) => payload);
}

/**
 * 모든 SHAPE_COMPONENT 페이로드(16진수)와 개체 컨트롤 ID를 쓴 횟수. 묶음(`$con`) 안의 개체는 SHAPE_COMPONENT의
 * 자식이고 ID를 한 번만 쓴다(정정 107).
 */
function shapeComponentsWithIdCount(bytes: Uint8Array): [string, 1 | 2][] {
  const c = CFB.read(bytes, { type: "buffer" });
  const header = CFB.find(c, "FileHeader")!.content as Uint8Array;
  const compressed = (header[36]! & 1) === 1;
  const out: [string, 1 | 2][] = [];
  const walk = (n: RecordNode, parent?: RecordNode): void => {
    if (n.tagId === SectionTag.ShapeComponent)
      out.push([
        hex(n.payload),
        parent?.tagId === SectionTag.ShapeComponent ? 1 : 2,
      ]);
    n.children.forEach((child) => walk(child, n));
  };
  for (const p of c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p))) {
    const data = new Uint8Array(
      CFB.find(c, p.replace(/^[^/]*/, ""))!.content as Uint8Array,
    );
    buildRecordTree(parseRecords(maybeInflate(data, compressed))).forEach(walk);
  }
  return out;
}

/** 모든 SHAPE_COMPONENT_RECTANGLE 페이로드(16진수)를 나온 순서대로. */
function rectangles(bytes: Uint8Array): string[] {
  const c = CFB.read(bytes, { type: "buffer" });
  const header = CFB.find(c, "FileHeader")!.content as Uint8Array;
  const compressed = (header[36]! & 1) === 1;
  const out: string[] = [];
  const walk = (n: RecordNode): void => {
    if (n.tagId === SectionTag.ShapeComponentRectangle)
      out.push(hex(n.payload));
    n.children.forEach(walk);
  };
  for (const p of c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p))) {
    const data = new Uint8Array(
      CFB.find(c, p.replace(/^[^/]*/, ""))!.content as Uint8Array,
    );
    buildRecordTree(parseRecords(maybeInflate(data, compressed))).forEach(walk);
  }
  return out;
}

type Gso = Extract<Control, { type: "unknown" | "rectangle" }>;

/** 첫 구역 문단에 놓인 `gso ` 컨트롤. 사각형은 RectangleControl, 나머지는 unknown이다. */
function drawingObjects(doc: ReturnType<typeof parseHwp>): Gso[] {
  return doc.sections[0]!.paragraphs.flatMap((p) =>
    p.runs.flatMap((r) => r.items),
  ).filter(
    (i): i is Gso =>
      i.type === "rectangle" || (i.type === "unknown" && i.ctrlId === "gso "),
  );
}

/** SHAPE_COMPONENT 필드. 사각형은 컨트롤에 펼쳐져 있고, unknown은 shapeComponent에 있다. */
const shapeOf = (c: Gso): RectangleControl | ShapeComponent =>
  c.type === "rectangle" ? c : c.shapeComponent!;

const rectangleOf = (c: Gso | undefined): RectangleControl => {
  expect(c?.type).toBe("rectangle");
  return c as RectangleControl;
};

const load = (path: string) =>
  parseHwp(new Uint8Array(readFileSync(join(root, path))));

describe("저장소 HWP 파일의 SHAPE_COMPONENT", () => {
  const withShapes = files.filter(
    (f) => shapeComponents(new Uint8Array(readFileSync(f))).length > 0,
  );

  it("그리기 개체가 든 파일이 있다", () => {
    expect(withShapes.length).toBeGreaterThan(0);
  });

  // 원본 비트 보존: 개체 요소 속성을 모델로 읽고 다시 쓴 레코드가 원본과 바이트 단위로 같아야 한다.
  it.each(withShapes.map((f) => [f.slice(root.length + 1), f]))(
    "%s 왕복",
    (_, file) => {
      const bytes = new Uint8Array(readFileSync(file));
      const written = serializeHwp(parseHwp(bytes));
      expect(shapeComponents(written)).toEqual(shapeComponents(bytes));
      expect(rectangles(written)).toEqual(rectangles(bytes));
    },
  );

  it("저장소의 사각형은 모두 RectangleControl로 읽는다", () => {
    for (const file of withShapes) {
      const bytes = new Uint8Array(readFileSync(file));
      const all = parseHwp(bytes)
        .sections.flatMap((s) => s.paragraphs)
        .flatMap((p) => p.runs.flatMap((r) => r.items));
      // 사각형 레코드를 해석하지 못해 unknown으로 남은 사각형이 없다.
      const unread = all.filter(
        (i) => i.type === "unknown" && i.shapeComponent?.shapeId === "$rec",
      );
      expect(unread, file).toEqual([]);
    }
  });

  it.each(withShapes.map((f) => [f.slice(root.length + 1), f]))(
    "%s 모델로 읽음",
    (_, file) => {
      const payloads = shapeComponentsWithIdCount(
        new Uint8Array(readFileSync(file)),
      );
      for (const [p, idCount] of payloads) {
        const shape = readShapeComponent(Buffer.from(p, "hex"), idCount);
        expect(shape).toBeDefined();
        // 저장소의 그리기 개체는 사각형뿐이고, 모두 테두리 선·채우기·그림자를 모델로 읽어 남는 바이트가 없다.
        if (shape!.shapeId === "$rec") {
          expect(shape!.line).toBeDefined();
          expect(shape!.fill).toBeDefined();
          expect(shape!.shadow).toBeDefined();
          expect(shape!.instanceId).toBeDefined();
          expect(shape!.trailing).toBeUndefined();
        }
      }
    },
  );
});

describe("개체 요소 속성 값 (한글 2024)", () => {
  it("사각형: 크기, 명세에 없는 비트, 표 81 바이트", () => {
    const shape = rectangleOf(
      drawingObjects(
        load("docs/experiments/object-common-props/rect-caption-bottom.hwp"),
      )[0],
    );
    expect(shape).toMatchObject({
      groupOffsetX: 0,
      groupOffsetY: 0,
      groupLevel: 0,
      localVersion: 1,
      initialWidth: 19298,
      initialHeight: 13515,
      width: 19300,
      height: 13514,
      unknownBits: 0x80000,
      rotation: 0,
      rotationCenter: { x: 9650, y: 6757 },
      translation: [1, 0, 0, 0, 1, 0],
    });
    expect(shape.flipHorizontal).toBeUndefined();
    expect(shape.scaleRotations).toHaveLength(1);
    // 크기를 바꾼 만큼 scale matrix가 1에서 벗어난다.
    expect(shape.scaleRotations[0]!.scale[0]).toBeCloseTo(19300 / 19298, 10);
    expect(shape.scaleRotations[0]!.rotation).toEqual([1, 0, 0, 0, 1, 0]);
    // 한글 기본 사각형의 테두리 선: 검정 0.12mm 실선, Flat, 화살표 중간-중간 채움.
    expect(shape.line).toEqual({
      color: { r: 0, g: 0, b: 0, unknown: 0 },
      width: 33,
      style: LineStyle.Solid,
      endCap: LineEndCap.Flat,
      startArrow: ArrowStyle.None,
      endArrow: ArrowStyle.None,
      startArrowSize: ArrowSize.MediumMedium,
      endArrowSize: ArrowSize.MediumMedium,
      startArrowFill: true,
      endArrowFill: true,
      outlineStyle: OutlineStyle.Normal,
    });
    // 테두리 선 뒤의 채우기 정보 21바이트: 흰색 단색, 무늬 없음.
    expect(shape.fill).toEqual({
      color: {
        background: { r: 0xff, g: 0xff, b: 0xff, unknown: 0 },
        pattern: {
          style: HatchStyle.None,
          color: { r: 0, g: 0, b: 0, unknown: 0 },
        },
        transparency: 0,
      },
    });
    // 그 뒤의 명세에 없는 22바이트: 그림자 없음(색은 기본 회색)과 인스턴스 ID.
    expect(shape.shadow).toEqual({
      kind: ShapeShadowKind.None,
      color: { r: 0xb2, g: 0xb2, b: 0xb2, unknown: 0 },
      offsetX: 0,
      offsetY: 0,
      transparency: 0,
    });
    expect(shape.instanceId).toBe(0x0a8c5e98);
    expect(shape.afterInstanceId).toBeUndefined();
    expect(shape.trailing).toBeUndefined();
    // SHAPE_COMPONENT와 사각형 레코드를 모두 모델로 읽어 childRecords가 없다.
    expect(shape.childRecords).toBeUndefined();
    expect(shape.cornerCurvature).toBe(0);
    expect(shape.points).toEqual([
      { x: 0, y: 0 },
      { x: 19298, y: 0 },
      { x: 19298, y: 13515 },
      { x: 0, y: 13515 },
    ]);
    expect(shape.rectangleTrailing).toBeUndefined();
  });

  it("그림: Rendering 정보에서 레코드가 끝난다", () => {
    const doc = load("docs/experiments/bullet-image-id/base.hwp");
    const pic = doc.sections[0]!.paragraphs
      .flatMap((p) => p.runs.flatMap((r) => r.items))
      .find((i) => i.type === "picture") as PictureControl;
    expect(pic).toMatchObject({
      width: 7381,
      height: 4500,
      unknownBits: 0x24080000,
    });
    expect(pic.line).toBeUndefined();
    expect(pic.fill).toBeUndefined();
    expect(pic.trailing).toBeUndefined();
  });
});

describe("Outline style (experiments/shape-outline-style, 한글 2024)", () => {
  const outline = (file: string) =>
    shapeOf(
      drawingObjects(load(`docs/experiments/shape-outline-style/${file}`))[0]!,
    ).line!.outlineStyle;

  it('"선 굵기 내부 적용"은 2, 끄면 0이다', () => {
    expect(outline("inner.hwp")).toBe(OutlineStyle.Inner);
    expect(outline("unchecked.hwp")).toBe(OutlineStyle.Normal);
  });

  it("대화상자가 만들지 않는 1과 범위 밖의 3도 그대로 읽는다", () => {
    expect(outline("outline-1-resaved.hwp")).toBe(OutlineStyle.Outer);
    expect(outline("outline-1-dialog-ok.hwp")).toBe(OutlineStyle.Normal);
    expect(outline("outline-3-resaved.hwp")).toBe(3);
  });
});

describe("채우기 (experiments/shape-fill, 한글 2024)", () => {
  const fillOf = (file: string) => {
    const shape = shapeOf(
      drawingObjects(load(`docs/experiments/shape-fill/${file}.hwp`))[0]!,
    );
    // 채우기와 그림자를 모두 모델로 읽어 남는 바이트가 없다.
    expect(shape.shadow).toBeDefined();
    expect(shape.trailing).toBeUndefined();
    return shape.fill!;
  };

  it("채우기 없음, 그러데이션, 그림", () => {
    expect(fillOf("none")).toEqual({});
    expect(fillOf("gradient").gradient).toMatchObject({
      angle: 90,
      step: 255,
      stepCenter: 50,
      transparency: 0,
    });
    expect(fillOf("image")).toEqual({
      image: expect.objectContaining({
        mode: 5,
        binDataId: 0,
        transparency: 0,
      }),
    });
  });

  it("채우기 투명도 30%는 켜진 종류마다 77이다", () => {
    expect(fillOf("color-alpha").color!.transparency).toBe(77);
    const colorImage = fillOf("color-image-alpha");
    expect([
      colorImage.color!.transparency,
      colorImage.image!.transparency,
    ]).toEqual([77, 77]);
    const gradientImage = fillOf("gradient-image");
    expect([
      gradientImage.gradient!.transparency,
      gradientImage.image!.transparency,
    ]).toEqual([77, 77]);
    expect(gradientImage.color).toBeUndefined();
  });

  it("색 + 그림", () => {
    const fill = fillOf("color-image");
    expect(fill.color).toBeDefined();
    expect(fill.image).toBeDefined();
    expect(fill.gradient).toBeUndefined();
  });
});

describe("그림자 (experiments/shape-shadow, 한글 2024)", () => {
  const shapeOf = (file: string) =>
    rectangleOf(
      drawingObjects(load(`docs/experiments/shape-shadow/${file}`))[0],
    );

  it("그림자 종류, 이동, 투명도와 인스턴스 ID", () => {
    const shape = shapeOf("shadow-1.hwp");
    expect(shape.shadow).toEqual({
      kind: ShapeShadowKind.ScaleNarrow,
      color: { r: 0xb2, g: 0xb2, b: 0xb2, unknown: 0 },
      offsetX: 283,
      offsetY: 566,
      transparency: 77,
    });
    // HWPX hp:rect instid="181272362"
    expect(shape.instanceId).toBe(181272362);
    expect(shapeOf("base.hwp").instanceId).toBe(181272362);
    expect(shapeOf("base.hwp").shadow!.kind).toBe(ShapeShadowKind.None);
  });

  it.each([
    ["type-r1c2", ShapeShadowKind.ParallelLeftTop],
    ["type-r1c3", ShapeShadowKind.ParallelRightTop],
    ["type-r2c2", ShapeShadowKind.ParallelLeftBottom],
    ["type-r2c3", ShapeShadowKind.ParallelRightBottom],
    ["type-r1c4", ShapeShadowKind.ShearLeftTop],
    ["type-r1c5", ShapeShadowKind.ShearRightTop],
    ["type-r2c4", ShapeShadowKind.ShearLeftBottom],
    ["type-r2c5", ShapeShadowKind.ShearRightBottom],
    ["type-r2c1", ShapeShadowKind.ScaleEnlarge],
  ])("%s의 그림자 종류는 %i", (file, kind) => {
    expect(shapeOf(`${file}.hwp`).shadow!.kind).toBe(kind);
  });

  it("고친 그림자 바이트만 바뀐다", () => {
    const path = "docs/experiments/shape-shadow/base.hwp";
    const bytes = new Uint8Array(readFileSync(join(root, path)));
    const doc = parseHwp(bytes);
    const shape = rectangleOf(drawingObjects(doc)[0]);
    shape.shadow = {
      ...shape.shadow!,
      kind: ShapeShadowKind.ScaleNarrow,
      offsetX: 283,
      offsetY: 566,
      transparency: 77,
    };
    const [after] = shapeComponents(serializeHwp(doc));
    const [expected] = shapeComponents(
      new Uint8Array(
        readFileSync(join(root, "docs/experiments/shape-shadow/shadow-1.hwp")),
      ),
    );
    // 한글이 같은 값으로 저장한 shadow-1과 SHAPE_COMPONENT가 같다.
    expect(after).toBe(expected);
  });
});

describe("읽은 테두리 선을 고치면", () => {
  it("테두리 선 13바이트만 바뀌고 나머지는 그대로다", () => {
    const path = "docs/experiments/object-common-props/rect-caption-bottom.hwp";
    const bytes = new Uint8Array(readFileSync(join(root, path)));
    const doc = parseHwp(bytes);
    const line = rectangleOf(drawingObjects(doc)[0]).line!;
    line.color = { r: 0x12, g: 0x34, b: 0x56, unknown: 0 };
    line.width = 283;
    line.style = LineStyle.Dashed;
    line.endArrow = ArrowStyle.Arrow;
    line.startArrowFill = false;
    line.outlineStyle = OutlineStyle.Inner;

    const [before] = shapeComponents(bytes).map((h) => Buffer.from(h, "hex"));
    const [after] = shapeComponents(serializeHwp(doc)).map((h) =>
      Buffer.from(h, "hex"),
    );
    // ID 8 + 개체 요소 속성 42 + 행렬 쌍 수 2 + 행렬 48×3 뒤가 테두리 선이다.
    const at = 8 + 42 + 2 + 48 * 3;
    expect(after!.subarray(at, at + 13).toString("hex")).toBe(
      "12345600" +
        "1b010000" +
        Buffer.from(Uint32Array.of(0x91010042).buffer).toString("hex") +
        "02",
    );
    expect(hex(after!.subarray(0, at))).toBe(hex(before!.subarray(0, at)));
    expect(hex(after!.subarray(at + 13))).toBe(hex(before!.subarray(at + 13)));
  });
});

describe("읽은 개체 요소 속성을 고치면", () => {
  it("고친 필드만 바뀌고 나머지 바이트와 하위 레코드는 그대로다", () => {
    const path = "docs/experiments/object-common-props/rect-caption-bottom.hwp";
    const bytes = new Uint8Array(readFileSync(join(root, path)));
    const doc = parseHwp(bytes);
    const rect = rectangleOf(drawingObjects(doc)[0]);
    rect.flipHorizontal = true;
    rect.width = 20000;

    const [before] = shapeComponents(bytes).map((h) => Buffer.from(h, "hex"));
    const [after] = shapeComponents(serializeHwp(doc)).map((h) =>
      Buffer.from(h, "hex"),
    );
    // 오프셋은 ID 8바이트 뒤 개체 요소 속성 기준: 현재 폭 20, 속성 28.
    expect(after!.readUInt32LE(8 + 20)).toBe(20000);
    expect(after!.readUInt32LE(8 + 28)).toBe(0x80001);
    after!.writeUInt32LE(before!.readUInt32LE(8 + 20), 8 + 20);
    after!.writeUInt32LE(before!.readUInt32LE(8 + 28), 8 + 28);
    expect(hex(after!)).toBe(hex(before!));
  });
});

describe("읽은 채우기를 고치면", () => {
  it("채우기 바이트만 바뀌고 나머지는 그대로다", () => {
    const path = "docs/experiments/object-common-props/rect-caption-bottom.hwp";
    const bytes = new Uint8Array(readFileSync(join(root, path)));
    const doc = parseHwp(bytes);
    const shape = rectangleOf(drawingObjects(doc)[0]);
    shape.fill!.color!.background = { r: 0x12, g: 0x34, b: 0x56, unknown: 0 };

    const [before] = shapeComponents(bytes).map((h) => Buffer.from(h, "hex"));
    const [after] = shapeComponents(serializeHwp(doc)).map((h) =>
      Buffer.from(h, "hex"),
    );
    // 테두리 선 뒤 채우기 종류 4바이트 다음이 배경색이다.
    const at = 8 + 42 + 2 + 48 * 3 + 13 + 4;
    expect(hex(after!.subarray(at, at + 4))).toBe("12345600");
    after!.set(before!.subarray(at, at + 4), at);
    expect(hex(after!)).toBe(hex(before!));
  });

  it("채우기 없음으로 바꾸면 종류와 추가 속성 길이만 쓴다", () => {
    const path = "docs/experiments/object-common-props/rect-caption-bottom.hwp";
    const doc = parseHwp(new Uint8Array(readFileSync(join(root, path))));
    const shape = rectangleOf(drawingObjects(doc)[0]);
    shape.fill = {};
    const [after] = shapeComponents(serializeHwp(doc)).map((h) =>
      Buffer.from(h, "hex"),
    );
    const at = 8 + 42 + 2 + 48 * 3 + 13;
    const [before] = shapeComponents(
      new Uint8Array(readFileSync(join(root, path))),
    ).map((h) => Buffer.from(h, "hex"));
    expect(hex(after!.subarray(at, at + 8))).toBe("0000000000000000");
    // 그림자 22바이트는 그대로 뒤따른다.
    expect(hex(after!.subarray(at + 8))).toBe(
      hex(before!.subarray(before!.length - 22)),
    );
  });
});

describe("readShapeComponent", () => {
  const sample = (): ShapeComponent => ({
    shapeId: "$rec",
    groupOffsetX: 0,
    groupOffsetY: 0,
    groupLevel: 0,
    localVersion: 1,
    initialWidth: 100,
    initialHeight: 50,
    width: 100,
    height: 50,
    rotation: 0,
    rotationCenter: { x: 50, y: 25 },
    translation: [1, 0, 0, 0, 1, 0],
    scaleRotations: [
      { scale: [1, 0, 0, 0, 1, 0], rotation: [1, 0, 0, 0, 1, 0] },
    ],
  });

  it("쓴 레코드를 다시 읽으면 같다", () => {
    const bytes = writeShapeComponent(sample()).finish();
    expect(bytes).toHaveLength(8 + 42 + 2 + 48 * 3);
    expect(readShapeComponent(bytes)).toEqual(sample());
  });

  it("ID가 두 번 오지 않으면 해석하지 않는다", () => {
    const bytes = writeShapeComponent(sample()).finish();
    bytes[4] = 0;
    expect(readShapeComponent(bytes)).toBeUndefined();
  });

  it("행렬보다 짧은 레코드는 해석하지 않는다", () => {
    const bytes = writeShapeComponent(sample()).finish();
    expect(
      readShapeComponent(bytes.subarray(0, bytes.length - 1)),
    ).toBeUndefined();
    expect(readShapeComponent(bytes.subarray(0, 20))).toBeUndefined();
  });

  it("유한하지 않은 행렬 원소가 있으면 해석하지 않는다", () => {
    const bytes = writeShapeComponent(sample()).finish();
    new DataView(bytes.buffer, bytes.byteOffset).setFloat64(
      52,
      Number.NaN,
      true,
    );
    expect(readShapeComponent(bytes)).toBeUndefined();
  });

  const line = (): ShapeLine => ({
    color: { r: 0, g: 0, b: 0, unknown: 0 },
    width: 33,
    style: LineStyle.Solid,
    endCap: LineEndCap.Flat,
    startArrow: ArrowStyle.None,
    endArrow: ArrowStyle.None,
    startArrowSize: ArrowSize.MediumMedium,
    endArrowSize: ArrowSize.MediumMedium,
    startArrowFill: true,
    endArrowFill: true,
    outlineStyle: OutlineStyle.Normal,
  });

  it("그리기 개체의 테두리 선을 쓰고 다시 읽는다", () => {
    const shape = {
      ...sample(),
      line: line(),
      trailing: Uint8Array.of(1, 2, 3),
    };
    const bytes = writeShapeComponent(shape).finish();
    expect(bytes).toHaveLength(8 + 42 + 2 + 48 * 3 + 13 + 3);
    expect(readShapeComponent(bytes)).toEqual(shape);
  });

  it("그리기 개체가 아니면 테두리 선으로 읽지 않는다", () => {
    const shape = {
      ...sample(),
      shapeId: "$pic",
      trailing: new Uint8Array(13),
    };
    expect(readShapeComponent(writeShapeComponent(shape).finish())).toEqual(
      shape,
    );
  });

  it("테두리 선보다 짧으면 테두리 선으로 읽지 않는다", () => {
    const shape = { ...sample(), trailing: new Uint8Array(12) };
    expect(readShapeComponent(writeShapeComponent(shape).finish())).toEqual(
      shape,
    );
  });

  const lineBytes = (): Uint8Array => {
    const written = writeShapeComponent({ ...sample(), line: line() }).finish();
    return written.subarray(8 + 42 + 2 + 48 * 3);
  };
  const withTail = (tail: number[]): Uint8Array => {
    const head = writeShapeComponent({ ...sample(), line: line() }).finish();
    return Uint8Array.from([...head, ...tail]);
  };

  it("채우기를 쓰고 다시 읽는다", () => {
    const shape: ShapeComponent = {
      ...sample(),
      line: line(),
      fill: {
        color: {
          background: { r: 1, g: 2, b: 3, unknown: 0 },
          pattern: {
            style: HatchStyle.None,
            color: { r: 0, g: 0, b: 0, unknown: 0 },
          },
          transparency: 0,
        },
      },
      trailing: Uint8Array.of(9, 9),
    };
    const bytes = writeShapeComponent(shape).finish();
    expect(bytes).toHaveLength(8 + 42 + 2 + 48 * 3 + 13 + 21 + 2);
    expect(readShapeComponent(bytes)).toEqual(shape);
  });

  it("여러 종류가 켜진 채우기와 추가 속성 바이트도 모델로 읽는다", () => {
    expect(lineBytes()).toHaveLength(13);
    // 단색과 그림이 함께 켜진 채우기(종류 3). 투명도는 종류마다 하나씩.
    const multi = [
      3,
      0,
      0,
      0,
      ...[255, 255, 255, 0],
      ...[0, 0, 0, 0],
      ...[255, 255, 255, 255],
      ...[5, 0, 0, 0, 1, 0],
      ...[0, 0, 0, 0],
      77,
      77,
    ];
    const shape = readShapeComponent(withTail(multi))!;
    expect(shape.line).toEqual(line());
    expect(shape.fill?.color?.transparency).toBe(77);
    expect(shape.fill?.image).toMatchObject({
      mode: 5,
      binDataId: 0,
      transparency: 77,
    });
    expect(shape.trailing).toBeUndefined();
    // 추가 채우기 속성에 모르는 바이트가 있는 단색 채우기.
    const extra = [1, 0, 0, 0, ...new Array(12).fill(0), 2, 0, 0, 0, 7, 7, 0];
    const extraShape = readShapeComponent(withTail(extra))!;
    expect([...extraShape.fill!.extraProperties!]).toEqual([7, 7]);
    expect(hex(writeShapeComponent(extraShape).finish())).toBe(
      hex(withTail(extra)),
    );
  });

  it("다시 쓰면 바이트가 달라지는 채우기는 trailing에 원본 그대로 남긴다", () => {
    // 단색 블록 중간에서 끝나는 짧은 채우기.
    const short = [1, 0, 0, 0, 255, 255];
    const shortShape = readShapeComponent(withTail(short))!;
    expect(shortShape.fill).toBeUndefined();
    expect([...shortShape.trailing!]).toEqual(short);
  });

  const shadow = () => ({
    kind: ShapeShadowKind.None,
    color: { r: 0xb2, g: 0xb2, b: 0xb2, unknown: 0 },
    offsetX: 0,
    offsetY: 0,
    transparency: 0,
  });
  const fill = (): Fill => ({});

  it("그림자와 인스턴스 ID를 쓰고 다시 읽는다", () => {
    const shape: ShapeComponent = {
      ...sample(),
      line: line(),
      fill: fill(),
      shadow: {
        ...shadow(),
        kind: ShapeShadowKind.ShearRightBottom,
        offsetX: -283,
        transparency: 255,
      },
      instanceId: 0xffffffff,
      afterInstanceId: 7,
    };
    const bytes = writeShapeComponent(shape).finish();
    expect(bytes).toHaveLength(8 + 42 + 2 + 48 * 3 + 13 + 8 + 22);
    expect(readShapeComponent(bytes)).toEqual(shape);
  });

  it("그림자보다 짧으면 그림자로 읽지 않는다", () => {
    const shape: ShapeComponent = {
      ...sample(),
      line: line(),
      fill: fill(),
      trailing: new Uint8Array(21),
    };
    expect(readShapeComponent(writeShapeComponent(shape).finish())).toEqual(
      shape,
    );
  });

  it("그림자와 인스턴스 ID 하나만 있거나 범위를 넘으면 쓰지 않는다", () => {
    const base = { ...sample(), line: line(), fill: fill() };
    expect(() => writeShapeComponent({ ...base, shadow: shadow() })).toThrow(
      RangeError,
    );
    expect(() => writeShapeComponent({ ...base, instanceId: 1 })).toThrow(
      RangeError,
    );
    expect(() =>
      writeShapeComponent({ ...sample(), shadow: shadow(), instanceId: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      writeShapeComponent({
        ...base,
        shadow: { ...shadow(), transparency: 256 },
        instanceId: 1,
      }),
    ).toThrow(RangeError);
  });

  it("비트 필드를 넘는 테두리 선 값은 쓰지 않는다", () => {
    const write = (patch: Partial<ShapeLine>) => () =>
      writeShapeComponent({ ...sample(), line: { ...line(), ...patch } });
    expect(write({ style: 64 as LineStyle })).toThrow(RangeError);
    expect(write({ endCap: 16 as LineEndCap })).toThrow(RangeError);
    expect(write({ endArrow: -1 as ArrowStyle })).toThrow(RangeError);
    expect(write({ startArrowSize: 16 as ArrowSize })).toThrow(RangeError);
    expect(write({ outlineStyle: 256 as OutlineStyle })).toThrow(RangeError);
    expect(write({ width: 2 ** 31 })).toThrow(RangeError);
    expect(write({ endArrow: 63 as ArrowStyle })).not.toThrow();
  });

  it("잘못된 값은 쓰지 않는다", () => {
    expect(() => writeShapeComponent({ ...sample(), shapeId: "$re" })).toThrow(
      RangeError,
    );
    expect(() => writeShapeComponent({ ...sample(), width: -1 })).toThrow(
      RangeError,
    );
    expect(() =>
      writeShapeComponent({
        ...sample(),
        translation: [1, 0, 0, 0, 1, Infinity],
      }),
    ).toThrow(RangeError);
  });
});

describe("채우기 투명도 (experiments/fill-alpha, 한글 2024)", () => {
  const dir = "docs/experiments/fill-alpha";
  it("그리기 개체는 블록 순서대로 단색, 그림의 투명도를 읽고, 한글은 다시 저장해도 보존한다", () => {
    const fill = (file: string) =>
      shapeOf(drawingObjects(load(`${dir}/${file}.hwp`))[0]!).fill!;
    expect(
      [0, 77, 200, 255].map((n) => fill(`shape-red-${n}`).color!.transparency),
    ).toEqual([0, 77, 200, 255]);
    expect([
      fill("shape-red-image-0-200").color!.transparency,
      fill("shape-red-image-0-200").image!.transparency,
    ]).toEqual([0, 200]);
    expect(fill("resaved-shape-red-200").color!.transparency).toBe(200);
  });

  it("그러데이션과 그림도 블록 순서대로 투명도를 읽는다", () => {
    const fill = (file: string) =>
      shapeOf(drawingObjects(load(`${dir}/${file}.hwp`))[0]!).fill!;
    expect(fill("shape-gradient-200").gradient!.transparency).toBe(200);
    const f = fill("shape-gradient-image-0-200");
    expect([f.gradient!.transparency, f.image!.transparency]).toEqual([0, 200]);
  });

  it.each([
    ["resaved-cell-red-255", 3],
    ["resaved-para-red-255", 2],
    ["resaved-page-blue-255", 3],
    ["resaved-char-yellow-255", 4],
  ])(
    "%s: DocInfo 테두리/배경의 투명도는 그리지 않지만 한글이 보존한다",
    (file, index) => {
      expect(
        load(`${dir}/${file}.hwp`).borderFills[index]!.fill!.color!
          .transparency,
      ).toBe(255);
    },
  );
});

describe("사각형 (experiments/shape-rectangle, 한글 2024)", () => {
  const dir = "docs/experiments/shape-rectangle";
  const shapeOf = (file: string) =>
    rectangleOf(drawingObjects(load(`${dir}/${file}.hwp`))[0]);
  const corners = [
    { x: 0, y: 0 },
    { x: 23134, y: 0 },
    { x: 23134, y: 15403 },
    { x: 0, y: 15403 },
  ];

  it.each([
    ["base", 0],
    ["corner-round", 20],
    ["corner-half", 50],
    ["corner-35", 35],
  ])(
    "%s의 모서리 곡률은 %i이고 꼭짓점은 (x, y) 쌍 네 개다",
    (file, curvature) => {
      expect(shapeOf(file)).toMatchObject({
        cornerCurvature: curvature,
        points: corners,
      });
      expect(shapeOf(file).rectangleTrailing).toBeUndefined();
    },
  );

  it("폭을 바꿔도 꼭짓점은 만들 때 크기 그대로이고 SHAPE_COMPONENT의 현재 폭과 scale matrix가 바뀐다", () => {
    const shape = shapeOf("corner-35-width-100");
    expect(shape.points).toEqual(corners);
    expect([shape.initialWidth, shape.width]).toEqual([23134, 28345]);
    // 한글의 scale은 폭 비율과 소수 다섯째 자리에서 다르다(1.225296… 대 1.225253…).
    expect(shape.scaleRotations[0]!.scale[0]).toBeCloseTo(28345 / 23134, 3);
  });

  it("고친 곡률만 바뀐다", () => {
    const path = `${dir}/base.hwp`;
    const bytes = new Uint8Array(readFileSync(join(root, path)));
    const doc = parseHwp(bytes);
    rectangleOf(drawingObjects(doc)[0]).cornerCurvature = 35;
    const written = serializeHwp(doc);
    // 한글이 곡률 35로 저장한 corner-35와 SHAPE_COMPONENT 하위 트리가 같다.
    const expected = new Uint8Array(
      readFileSync(join(root, `${dir}/corner-35.hwp`)),
    );
    expect(rectangles(written)).toEqual(rectangles(expected));
  });
});

describe("readShapeRectangle", () => {
  const rect = (): Pick<
    RectangleControl,
    "cornerCurvature" | "points" | "rectangleTrailing"
  > => ({
    cornerCurvature: 20,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: -1, y: 50 },
    ],
  });

  it("쓴 레코드를 다시 읽으면 같다", () => {
    const bytes = writeShapeRectangle(rect()).finish();
    expect(bytes).toHaveLength(33);
    expect(readShapeRectangle(bytes)).toEqual(rect());
    const withTail = writeShapeRectangle({
      ...rect(),
      rectangleTrailing: Uint8Array.of(1, 2),
    }).finish();
    expect([...readShapeRectangle(withTail)!.rectangleTrailing!]).toEqual([
      1, 2,
    ]);
  });

  it("33바이트보다 짧으면 읽지 않는다", () => {
    expect(
      readShapeRectangle(writeShapeRectangle(rect()).finish().subarray(0, 32)),
    ).toBeUndefined();
  });

  it("범위를 넘는 값은 쓰지 않는다", () => {
    expect(() =>
      writeShapeRectangle({ ...rect(), cornerCurvature: 256 }),
    ).toThrow(RangeError);
    expect(() =>
      writeShapeRectangle({
        ...rect(),
        points: rect().points.slice(0, 3) as never,
      }),
    ).toThrow(RangeError);
  });
});

describe("글상자 (정정 91, experiments/object-overlap-lock, 한글 2024)", () => {
  const path =
    "docs/experiments/object-overlap-lock/rect-para-limit-off-270mm.hwp";
  const bytes = () => new Uint8Array(readFileSync(join(root, path)));
  /** 모든 SHAPE_COMPONENT 아래 레코드(태그:16진수). 글상자 LIST_HEADER와 문단이 들어 있다. */
  function shapeSubtrees(file: Uint8Array): string[] {
    const c = CFB.read(file, { type: "buffer" });
    const compressed =
      ((CFB.find(c, "FileHeader")!.content as Uint8Array)[36]! & 1) === 1;
    const out: string[] = [];
    const all = (n: RecordNode): void => {
      out.push(`${n.tagId}:${hex(n.payload)}`);
      n.children.forEach(all);
    };
    const walk = (n: RecordNode): void =>
      n.tagId === SectionTag.ShapeComponent ? all(n) : n.children.forEach(walk);
    const data = new Uint8Array(
      CFB.find(c, "/BodyText/Section0")!.content as Uint8Array,
    );
    buildRecordTree(parseRecords(maybeInflate(data, compressed))).forEach(walk);
    return out;
  }
  const textBoxOf = (doc: ReturnType<typeof parseHwp>) =>
    drawingObjects(doc).find(
      (r): r is RectangleControl => r.type === "rectangle" && !!r.textBox,
    )!;

  it("LIST_HEADER 8B 뒤 여백 ×4, 최대 폭, 0 13B를 읽는다", () => {
    const rect = textBoxOf(parseHwp(bytes()));
    expect(rect.childRecords).toBeUndefined();
    expect(rect.textBox).toMatchObject({
      margins: { left: 283, right: 283, top: 283, bottom: 283 },
      maxWidth: rect.width,
      verticalAlign: 2, // VerticalAlign.Center
      textBoxTrailing: new Uint8Array(13),
    });
    expect(rect.textBox!.paragraphs).toHaveLength(1);
  });

  it("SHAPE_COMPONENT 하위 트리를 원본과 같은 바이트로 다시 쓴다", () => {
    expect(shapeSubtrees(serializeHwp(parseHwp(bytes())))).toEqual(
      shapeSubtrees(bytes()),
    );
  });

  it("고친 여백만 바뀌고 새 글상자 끝은 0 13B다", () => {
    const doc = parseHwp(bytes());
    const box = textBoxOf(doc).textBox!;
    box.margins.left = 567;
    delete box.textBoxTrailing;
    const header = shapeSubtrees(serializeHwp(doc)).find((r) =>
      r.startsWith(`${SectionTag.ListHeader}:01000000`),
    )!;
    expect(header.split(":")[1]).toBe(
      "010000002000000037021b011b011b015e5a0000" + "00".repeat(13),
    );
  });
});

describe("선 (정정 95, experiments/shape-line, 한글 macOS)", () => {
  const path = "docs/experiments/shape-line/directions.hwp";
  const bytes = () => new Uint8Array(readFileSync(join(root, path)));
  const section = (file: Uint8Array): string => {
    const c = CFB.read(file, { type: "buffer" });
    const compressed =
      ((CFB.find(c, "FileHeader")!.content as Uint8Array)[36]! & 1) === 1;
    return hex(
      maybeInflate(
        new Uint8Array(
          CFB.find(c, "/BodyText/Section0")!.content as Uint8Array,
        ),
        compressed,
      ),
    );
  };
  const lines = (doc: ReturnType<typeof parseHwp>) =>
    doc.sections[0]!.paragraphs.flatMap((p) =>
      p.runs.flatMap((r) => r.items),
    ) as LineControl[];

  it("그린 순서대로 시작점·끝점과 reverseHV를 읽는다", () => {
    const got = lines(parseHwp(bytes())).map((l) => [
      l.type,
      l.start,
      l.end,
      l.reverseHV ?? false,
      [...l.lineTrailing!],
    ]);
    const box = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(got).toEqual([
      ["line", { x: 0, y: 0 }, { x: 14298, y: 7149 }, false, [0, 0]], // 왼쪽 위 → 오른쪽 아래
      ["line", { x: 14298, y: 0 }, { x: 0, y: 7149 }, false, [0, 0]], // 오른쪽 위 → 왼쪽 아래
      ["line", ...box, true, [0, 0]], // 가로, 오른쪽 → 왼쪽
      ["line", ...box, true, [0, 0]], // 세로, 아래 → 위
      ["line", ...box, false, [0, 0]], // 가로, 왼쪽 → 오른쪽
      ["line", { x: 0, y: 7149 }, { x: 14298, y: 0 }, false, [0, 0]], // 왼쪽 아래 → 오른쪽 위
      ["line", ...box, false, [0, 0]], // 세로, 위 → 아래
    ]);
  });

  it("구역 스트림을 원본과 같은 바이트로 다시 쓴다", () => {
    expect(section(serializeHwp(parseHwp(bytes())))).toBe(section(bytes()));
  });

  it("짧은 18바이트 레코드는 18바이트로, 새 선은 한글처럼 20바이트로 쓴다", () => {
    const short = readLineShape(new Uint8Array(18))!;
    expect(writeLineShape(short).finish()).toHaveLength(18);
    const { lineTrailing: _, ...fresh } = short;
    expect([...writeLineShape({ ...fresh, reverseHV: true }).finish()]).toEqual(
      [...new Array(16).fill(0), 1, 0, 0, 0],
    );
    expect(readLineShape(new Uint8Array(17))).toBeUndefined();
  });
});

describe("타원·호·다각형·곡선 (정정 96~98, E45, 한글 macOS)", () => {
  const path = "docs/experiments/shape-ellipse-arc-polygon-curve/shapes.hwp";
  const bytes = () => new Uint8Array(readFileSync(join(root, path)));
  const items = () =>
    parseHwp(bytes()).sections[0]!.paragraphs.flatMap((p) =>
      p.runs.flatMap((r) => r.items),
    );
  const sectionHex = (file: Uint8Array): string => {
    const c = CFB.read(file, { type: "buffer" });
    const compressed =
      ((CFB.find(c, "FileHeader")!.content as Uint8Array)[36]! & 1) === 1;
    return hex(
      maybeInflate(
        new Uint8Array(
          CFB.find(c, "/BodyText/Section0")!.content as Uint8Array,
        ),
        compressed,
      ),
    );
  };

  it("HWPX와 같은 점을 읽는다", () => {
    const [ellipse, arc, open, closed, curve] = items() as [
      EllipseControl,
      ArcControl,
      PolygonControl,
      PolygonControl,
      CurveControl,
    ];
    expect(ellipse).toMatchObject({
      type: "ellipse",
      center: { x: 7149, y: 4289 },
      axis1: { x: 14298, y: 4289 },
      axis2: { x: 7149, y: 0 },
      start1: { x: 0, y: 0 },
      end2: { x: 0, y: 0 },
    });
    expect(ellipse.arcKind).toBeUndefined();
    expect(arc).toMatchObject({
      type: "arc",
      arcKind: 0,
      center: { x: 0, y: 0 },
      axis1: { x: 0, y: 8578 },
      axis2: { x: 14298, y: 0 },
    });
    expect(open.points).toEqual([
      { x: 0, y: 2144 },
      { x: 14298, y: 0 },
      { x: 16443, y: 10008 },
      { x: 3575, y: 12868 },
    ]);
    expect([...open.polygonTrailing!]).toEqual([0, 0, 0, 0]);
    // 닫힌 다각형은 첫 점을 끝에 한 번 더 쓰고 끝 4바이트가 1이다.
    expect(closed.points.at(-1)).toEqual(closed.points[0]);
    expect([...closed.polygonTrailing!]).toEqual([1, 0, 0, 0]);
    expect(curve.points).toEqual([
      { x: 0, y: 1659 },
      { x: 7149, y: 229 },
      { x: 12868, y: 5948 },
      { x: 20017, y: 3089 },
    ]);
    expect(curve.segmentTypes).toEqual([1, 1, 1]);
    expect([...curve.curveTrailing!]).toEqual([0, 0, 0, 0]);
  });

  it("구역 스트림을 원본과 같은 바이트로 다시 쓴다", () => {
    expect(sectionHex(serializeHwp(parseHwp(bytes())))).toBe(
      sectionHex(bytes()),
    );
  });

  it("짧거나 점 수가 레코드보다 크면 읽지 않는다", () => {
    expect(readEllipseShape(new Uint8Array(59))).toBeUndefined();
    expect(readArcShape(new Uint8Array(24))).toBeUndefined();
    expect(
      readPolygonShape(Uint8Array.of(2, 0, 0, 0, ...new Array(8).fill(0))),
    ).toBeUndefined();
    expect(readCurveShape(Uint8Array.of(0, 0, 0, 0))).toBeUndefined();
    // 점 2개에 구간 종류 1바이트가 없다.
    expect(
      readCurveShape(Uint8Array.of(2, 0, 0, 0, ...new Array(16).fill(0))),
    ).toBeUndefined();
  });

  it("새로 만든 다각형·곡선은 한글처럼 끝에 0 4바이트를 쓴다", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(writePolygonShape({ points }).finish()).toHaveLength(4 + 16 + 4);
    expect(
      writeCurveShape({ points, segmentTypes: [0] }).finish(),
    ).toHaveLength(4 + 16 + 1 + 4);
    expect(() => writeCurveShape({ points, segmentTypes: [] })).toThrow(
      RangeError,
    );
  });
});

describe("호 종류 (정정 96, E46, 한글 macOS)", () => {
  const dir = "docs/experiments/shape-ellipse-arc-polygon-curve";
  it.each([
    ["shapes", ArcKind.Arc],
    ["arc-pie", ArcKind.Pie],
    ["arc-chord", ArcKind.Chord],
  ])("%s의 호 종류는 %i이다", (file, kind) => {
    const arc = load(`${dir}/${file}.hwp`)
      .sections[0]!.paragraphs.flatMap((p) => p.runs.flatMap((r) => r.items))
      .find((i): i is ArcControl => i.type === "arc")!;
    expect(arc.arcKind).toBe(kind);
  });
});

describe("호로 바꾼 타원 (정정 99, E47, Windows 한글 2024)", () => {
  const dir = "docs/experiments/shape-ellipse-arc-polygon-curve";
  const ellipseOf = (file: string) =>
    load(`${dir}/${file}.hwp`)
      .sections[0]!.paragraphs.flatMap((p) => p.runs.flatMap((r) => r.items))
      .find((i): i is EllipseControl => i.type === "ellipse")!;

  it.each([
    ["ellipse-edit-pie", ArcKind.Pie, 0x10000],
    ["ellipse-edit-arc", undefined, undefined],
    ["ellipse-edit-chord", ArcKind.Chord, undefined],
  ])("%s: bit 1과 bit 8~15 호 종류", (file, kind, unknown) => {
    const e = ellipseOf(file);
    expect(e.hasArcProperty).toBe(true);
    expect(e.arcKind).toBe(kind);
    expect(e.ellipseUnknownBits).toBe(unknown);
    // HWPX hp:ellipse와 같은 점
    expect([e.center, e.axis1, e.axis2, e.start1, e.end1]).toEqual([
      { x: 12368, y: 7420 },
      { x: 24736, y: 7420 },
      { x: 12368, y: 0 },
      { x: 24736, y: 7421 },
      { x: 12368, y: 0 },
    ]);
  });

  it("구역 스트림을 원본과 같은 바이트로 다시 쓴다", () => {
    const section = (file: Uint8Array): string => {
      const c = CFB.read(file, { type: "buffer" });
      const compressed =
        ((CFB.find(c, "FileHeader")!.content as Uint8Array)[36]! & 1) === 1;
      return hex(
        maybeInflate(
          new Uint8Array(
            CFB.find(c, "/BodyText/Section0")!.content as Uint8Array,
          ),
          compressed,
        ),
      );
    };
    for (const f of [
      "ellipse-edit-pie",
      "ellipse-edit-arc",
      "ellipse-edit-chord",
    ]) {
      const bytes = new Uint8Array(readFileSync(join(root, `${dir}/${f}.hwp`)));
      expect(section(serializeHwp(parseHwp(bytes)))).toBe(section(bytes));
    }
  });
});

describe("다각형 편집으로 만든 호의 점과 bit 16 (E48, Windows 한글 2024)", () => {
  const dir = "docs/experiments/shape-ellipse-arc-polygon-curve";
  const ellipses = (file: string) =>
    load(`${dir}/${file}.hwp`)
      .sections[0]!.paragraphs.flatMap((p) => p.runs.flatMap((r) => r.items))
      .filter((i): i is EllipseControl => i.type === "ellipse");

  it("start1은 편집점을 놓은 곳, end1은 편집점의 처음 자리(위)다", () => {
    expect(
      ellipses("ellipse-edit-angles").map((e) => [e.start1, e.end1]),
    ).toEqual([
      [
        { x: 24736, y: 7421 },
        { x: 12368, y: 0 },
      ], // 오른쪽 끝으로 끎: 1/4
      [
        { x: 12368, y: 14842 },
        { x: 12368, y: 0 },
      ], // 아래 끝으로 끎: 1/2
      [
        { x: 0, y: 7421 },
        { x: 12368, y: 0 },
      ], // 왼쪽 끝으로 끎: 3/4
    ]);
  });

  it("bit 16은 편집 직후 켜지고 개체 속성 설정을 누르면 꺼진다", () => {
    expect(
      ellipses("ellipse-edit-angles").map((e) => e.ellipseUnknownBits),
    ).toEqual([0x10000, 0x10000, 0x10000]);
    // 첫 타원만 개체 속성에서 설정을 눌렀다.
    expect(
      ellipses("ellipse-edit-angles-dialog").map((e) => e.ellipseUnknownBits),
    ).toEqual([undefined, 0x10000, 0x10000]);
  });
});

describe("다각형·곡선 닫기와 끝 4바이트 (E49, Windows 한글 2024)", () => {
  const dir = "docs/experiments/shape-ellipse-arc-polygon-curve";
  const shapes = (file: string) =>
    load(`${dir}/${file}.hwp`)
      .sections[0]!.paragraphs.flatMap((p) => p.runs.flatMap((r) => r.items))
      .filter(
        (i): i is PolygonControl | CurveControl =>
          i.type === "polygon" || i.type === "curve",
      );
  const summary = (file: string) =>
    shapes(file).map((s) => [
      s.type,
      s.points.length,
      s.points.at(-1)!.x === s.points[0]!.x &&
        s.points.at(-1)!.y === s.points[0]!.y,
      (s.type === "polygon" ? s.polygonTrailing : s.curveTrailing)![0],
    ]);

  it.each([
    "polygon-curve-drawn",
    "polygon-curve-toggled",
    "polygon-pen",
    "polygon-curve-textbox-caption-rotate",
  ])("%s의 구역 스트림을 원본과 같은 바이트로 다시 쓴다", (f) => {
    const section = (file: Uint8Array): string => {
      const c = CFB.read(file, { type: "buffer" });
      const compressed =
        ((CFB.find(c, "FileHeader")!.content as Uint8Array)[36]! & 1) === 1;
      return hex(
        maybeInflate(
          new Uint8Array(
            CFB.find(c, "/BodyText/Section0")!.content as Uint8Array,
          ),
          compressed,
        ),
      );
    };
    const bytes = new Uint8Array(readFileSync(join(root, `${dir}/${f}.hwp`)));
    expect(section(serializeHwp(parseHwp(bytes)))).toBe(section(bytes));
  });

  it("그린 직후: 첫 점을 다시 눌러 닫은 다각형만 끝 바이트가 1이다", () => {
    expect(summary("polygon-curve-drawn")).toEqual([
      ["polygon", 4, false, 0], // P1 열림
      ["polygon", 4, false, 0], // P2 열림
      ["polygon", 4, true, 1], // P3 첫 점을 눌러 닫음
      ["curve", 4, false, 0], // C1
      ["curve", 4, false, 0], // C2
    ]);
  });

  it("닫기는 첫 점을 끝에 더하고, 열기는 마지막 점을 옮긴다. 끝 바이트는 그대로다", () => {
    expect(summary("polygon-curve-toggled")).toEqual([
      ["polygon", 4, false, 0], // P1
      ["curve", 4, false, 0], // C1
      ["polygon", 5, true, 0], // P2 닫음
      ["polygon", 4, false, 1], // P3 엶
      ["curve", 5, true, 0], // C2 닫음
    ]);
  });
});

describe("글상자·캡션·회전·대칭이 있는 다각형·곡선 (E50, Windows 한글 2024)", () => {
  it("모두 모델로 읽고 원본 레코드가 남지 않는다", () => {
    const items = load(
      "docs/experiments/shape-ellipse-arc-polygon-curve/polygon-curve-textbox-caption-rotate.hwp",
    )
      .sections[0]!.paragraphs.flatMap((p) => p.runs.flatMap((r) => r.items))
      .filter(
        (i): i is PolygonControl | CurveControl =>
          i.type === "polygon" || i.type === "curve",
      );
    expect(
      items.map((i) => [
        i.type,
        i.textBox?.paragraphs.length,
        !!i.placement.caption,
        i.rotation,
        i.flipHorizontal ?? false,
        i.childRecords,
      ]),
    ).toEqual([
      ["polygon", 1, false, 0, false, undefined], // 도형 안에 글자 넣기
      ["curve", 1, false, 0, false, undefined],
      ["polygon", undefined, true, 0, false, undefined], // 캡션
      ["curve", undefined, true, 0, false, undefined],
      ["polygon", undefined, false, 30, false, undefined], // 회전각 30°
      ["curve", undefined, false, 0, true, undefined], // 좌우 대칭
    ]);
  });
});
