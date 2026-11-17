import { readFileSync } from "node:fs";
import * as CFB from "cfb";
import { maybeInflate, parseRecords, parseHwp, serializeHwp, DocInfoTag } from "@js-hwp/hwp";
const recs = (buf: Uint8Array) => { const cfb = CFB.read(buf, { type: "buffer" }); return parseRecords(maybeInflate(new Uint8Array((CFB.find(cfb, "DocInfo") as any).content), true)); };
const src = new Uint8Array(readFileSync(process.argv[2]!));
const a = recs(src).filter(r => r.tagId === DocInfoTag.FaceName), b = recs(serializeHwp(parseHwp(src))).filter(r => r.tagId === DocInfoTag.FaceName);
for (const i of [0, 3]) { console.log(Buffer.from(a[i]!.payload).toString("hex")); console.log(Buffer.from(b[i]!.payload).toString("hex")); }
