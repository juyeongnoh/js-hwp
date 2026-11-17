import { readFileSync } from "node:fs";
import * as CFB from "cfb";
import { maybeInflate, parseRecords, parseHwp, serializeHwp, DocInfoTag } from "@js-hwp/hwp";
const recs = (buf: Uint8Array) => { const cfb = CFB.read(buf, { type: "buffer" }); const c = ((CFB.find(cfb, "FileHeader") as any).content[36] & 1) === 1; return parseRecords(maybeInflate(new Uint8Array((CFB.find(cfb, "DocInfo") as any).content), c)); };
const src = new Uint8Array(readFileSync(process.argv[2]!));
const a = recs(src).filter(r => r.tagId === DocInfoTag.CharShape), b = recs(serializeHwp(parseHwp(src))).filter(r => r.tagId === DocInfoTag.CharShape);
const h = (u: Uint8Array) => Buffer.from(u).toString("hex");
console.log(a[0]!.payload.length, b[0]!.payload.length); console.log(h(a[0]!.payload)); console.log(h(b[0]!.payload));
