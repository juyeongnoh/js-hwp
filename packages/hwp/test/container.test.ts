import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ContainerControl,
  type GroupChild,
  type HwpDocument,
  walkControls,
  walkParagraphs,
} from "@js-hwp/core";
import CFB from "cfb";
import { describe, expect, it } from "vitest";
import { parseSection, serializeSection } from "../src/bodytext.js";
import { maybeInflate } from "../src/compress.js";
import { parseHwp, serializeHwp } from "../src/document.js";
import {
  buildRecordTree,
  flattenRecordTree,
  parseRecords,
  serializeRecords,
  type RecordNode,
} from "../src/record.js";
import { SectionTag } from "../src/tags.js";

// 묶음 개체(정정 107, E56). 표본은 한글 2024로 만들었다(docs/experiments/shape-container).
const root = join(__dirname, "../../..");
const sample = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(join(root, `docs/experiments/shape-container/${name}.hwp`)),
  );

const section0 = (bytes: Uint8Array): Uint8Array => {
  const c = CFB.read(bytes, { type: "buffer" });
  const header = CFB.find(c, "FileHeader")!.content as Uint8Array;
  const data = new Uint8Array(
    CFB.find(c, "/BodyText/Section0")!.content as Uint8Array,
  );
  return maybeInflate(data, (header[36]! & 1) === 1);
};

const containers = (doc: HwpDocument): ContainerControl[] =>
  [...walkControls(doc)].filter(
    (c): c is ContainerControl => c.type === "container",
  );

const only = (name: string): ContainerControl => {
  const doc = parseHwp(sample(name));
  const [container, ...rest] = containers(doc);
  expect(rest).toEqual([]);
  return container!;
};

const types = (children: GroupChild[]) => children.map((c) => c.type);

describe("묶음 개체 표본", () => {
  const names = [
    "two-polygons",
    "nested",
    "nested-rotate-flip",
    "nested-rotate-flip-caption",
    "textbox-picture",
  ];

  it.each(names)("%s: 그리기 개체가 모두 모델로 읽히고 구역이 바이트 그대로", (name) => {
    const bytes = sample(name);
    const doc = parseHwp(bytes);
    expect(
      [...walkControls(doc)].filter(
        (c) => c.type === "unknown" && c.ctrlId === "gso ",
      ),
    ).toEqual([]);
    expect(containers(doc)).toHaveLength(1);
    expect(Buffer.from(section0(serializeHwp(doc)))).toEqual(
      Buffer.from(section0(bytes)),
    );
  });

  it("two-polygons: 자식 ID 배열 뒤는 인스턴스 ID, 자식은 groupLevel 1", () => {
    const c = only("two-polygons");
    expect(c).toMatchObject({
      groupLevel: 0,
      unknownBits: 0x80000,
      initialWidth: 37175,
      initialHeight: 12868,
      instanceId: 0x0aff7c9a,
    });
    expect(c.containerTrailing).toBeUndefined();
    expect(c.scaleRotations).toHaveLength(1);
    expect(c.placement.numberingKind ?? 1).toBe(1);
    expect(types(c.children)).toEqual(["polygon", "polygon"]);
    expect(c.children.map((p) => "groupOffsetX" in p && p.groupOffsetX)).toEqual(
      [0, 22877],
    );
    for (const p of c.children) {
      expect(p).toMatchObject({ groupLevel: 1 });
      expect("scaleRotations" in p && p.scaleRotations).toHaveLength(2);
      expect("placement" in p).toBe(false);
    }
  });

  it("nested: 묶음 안 묶음은 ID를 한 번 쓰고 그 자식은 groupLevel 2", () => {
    const c = only("nested");
    expect(types(c.children)).toEqual(["container", "curve"]);
    const inner = c.children[0] as Omit<ContainerControl, "placement">;
    expect(inner).toMatchObject({
      groupLevel: 1,
      unknownBits: 0x90000,
      instanceId: 0x0aff7c9a,
    });
    expect(inner.scaleRotations).toHaveLength(2);
    expect(types(inner.children)).toEqual(["polygon", "polygon"]);
    for (const p of inner.children) {
      expect(p).toMatchObject({ groupLevel: 2 });
      expect("scaleRotations" in p && p.scaleRotations).toHaveLength(3);
    }
    expect(c.instanceId).toBe(0x0aff7c9c);
  });

  it("nested-rotate-flip-caption: 캡션은 바깥 개체, 회전·대칭은 바깥 묶음", () => {
    const c = only("nested-rotate-flip-caption");
    expect(c.placement.caption).toBeDefined();
    expect(c).toMatchObject({ rotation: 270, flipHorizontal: true });
    const doc = parseHwp(sample("nested-rotate-flip-caption"));
    expect([...walkParagraphs(doc)].some((l) => l.path.includes("/caption/"))).toBe(
      true,
    );
  });

  it("textbox-picture: 묶음 안 글상자와 그림", () => {
    const c = only("textbox-picture");
    expect(types(c.children)).toEqual(["rectangle", "picture"]);
    const [rect, picture] = c.children;
    expect(rect!.type === "rectangle" && rect!.textBox).toBeDefined();
    expect(picture).toMatchObject({
      groupOffsetX: 29298,
      groupOffsetY: 13867,
      width: 13500,
      height: 9000,
    });
    // 문단 순회가 묶음 안 글상자 문단에 닿는다.
    const doc = parseHwp(sample("textbox-picture"));
    expect(
      [...walkParagraphs(doc)].filter((l) => l.path.includes("/container/textbox/")),
    ).toHaveLength(1);
  });
});

describe("모델로 읽지 못하는 묶음은 원본 그대로", () => {
  /** 첫 `$con` SHAPE_COMPONENT를 고친 구역을 읽고 다시 쓴다. */
  const roundTrip = (patch: (con: RecordNode) => void) => {
    const bytes = sample("nested");
    const doc = parseHwp(bytes);
    const tree = buildRecordTree(parseRecords(section0(bytes)));
    const find = (n: RecordNode): RecordNode | undefined =>
      n.tagId === SectionTag.ShapeComponent &&
      String.fromCharCode(...[...n.payload.subarray(0, 4)].reverse()) === "$con"
        ? n
        : n.children.map(find).find(Boolean);
    patch(tree.map(find).find(Boolean)!);
    const data = serializeRecords(flattenRecordTree(tree));
    const section = parseSection(doc, data);
    expect(Buffer.from(serializeSection(doc, section, true))).toEqual(
      Buffer.from(data),
    );
    return section;
  };
  const items = (section: ReturnType<typeof parseSection>) =>
    section.paragraphs.flatMap((p) => p.runs.flatMap((r) => r.items));

  it("자식 수가 자식 레코드와 다르면 unknown", () => {
    const section = roundTrip((con) => {
      const p = con.payload.slice();
      // 행렬 쌍 1개인 맨 위 $con: 자식 수는 오프셋 196.
      new DataView(p.buffer).setUint16(196, 3, true);
      con.payload = p;
    });
    expect(items(section).filter((i) => i.type === "container")).toEqual([]);
  });

  it("자식 ID가 자식 레코드와 다르면 unknown", () => {
    const section = roundTrip((con) => {
      const p = con.payload.slice();
      new DataView(p.buffer).setUint32(198, 0x12345678, true);
      con.payload = p;
    });
    expect(items(section).filter((i) => i.type === "container")).toEqual([]);
  });

  it("읽지 못하는 자식은 그 자식만 unknown으로 둔다", () => {
    const section = roundTrip((con) => {
      // 곡선의 도형별 레코드를 떼어 내면 곡선을 모델로 읽지 못한다.
      con.children[1]!.children = [];
    });
    const [container] = items(section).filter(
      (i): i is ContainerControl => i.type === "container",
    );
    expect(types(container!.children)).toEqual(["container", "unknown"]);
  });

  it("인스턴스 ID 뒤의 바이트는 containerTrailing", () => {
    const section = roundTrip((con) => {
      const p = new Uint8Array(con.payload.length + 3);
      p.set(con.payload);
      p.set([1, 2, 3], con.payload.length);
      con.payload = p;
    });
    const [container] = items(section).filter(
      (i): i is ContainerControl => i.type === "container",
    );
    expect([...container!.containerTrailing!]).toEqual([1, 2, 3]);
  });
});
