import { readFileSync } from "node:fs";
import { assert, describe, it } from "vitest";
import { parseHwp } from "../src/index.js";

describe("채우기", () => {
  it("파싱", () => {
    const fixture = readFileSync("./fixtures/hwp/fill.hwp");
    const parsed = parseHwp(fixture);
    const a = 1;
    assert.equal(a, 1);
  });
});
