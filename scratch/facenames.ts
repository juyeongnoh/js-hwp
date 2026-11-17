import { readFileSync } from "node:fs";
import * as CFB from "cfb";
import { maybeInflate, parseRecords, ByteReader, DocInfoTag, ID_MAPPING_SLOTS } from "@js-hwp/hwp";
const buf = readFileSync(process.argv[2]!);
const cfb = CFB.read(buf, { type: "buffer" });
const e: any = CFB.find(cfb, "DocInfo");
const recs = parseRecords(maybeInflate(new Uint8Array(e.content), true));
const out: string[] = [];
for (const r of recs) {
  if (r.tagId === DocInfoTag.IdMappings) { const rd = new ByteReader(r.payload); console.log(ID_MAPPING_SLOTS.map((s: string) => `${s}=${rd.uint32()}`).slice(0,10).join(" ")); }
  if (r.tagId === DocInfoTag.FaceName) { const rd = new ByteReader(r.payload); rd.uint8(); const n = rd.uint16(); let s=""; for (let i=0;i<n;i++) s+=String.fromCharCode(rd.uint16()); out.push(s); }
}
console.log(out);
