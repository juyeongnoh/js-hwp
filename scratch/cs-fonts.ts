import { readFileSync } from "node:fs";
import { parseHwp } from "@js-hwp/hwp";
const doc: any = parseHwp(new Uint8Array(readFileSync(process.argv[2]!)));
console.log("fonts", doc.docInfo?.fonts?.map((f: any) => f.name) ?? doc.fonts?.map((f: any) => f.name));
const di = doc.docInfo ?? doc;
di.charShapes.forEach((c: any, i: number) => console.log(i, c.fontIds.join(","), c.height));
di.styles.forEach((s: any, i: number) => console.log("style", i, s.name, "cs", s.charShapeId, "ps", s.paraShapeId));
