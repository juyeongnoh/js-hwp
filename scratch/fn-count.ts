import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as CFB from "cfb";
import { maybeInflate, parseRecords, ByteReader, DocInfoTag, ID_MAPPING_SLOTS } from "@js-hwp/hwp";
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".hwp") ? [p] : []; });
let n = 0, bad = 0;
for (const f of walk(process.argv[2]!)) {
  try {
    const buf = readFileSync(f); const cfb = CFB.read(buf, { type: "buffer" });
    const hdr: any = CFB.find(cfb, "FileHeader"); const compressed = (hdr.content[36] & 1) === 1;
    const e: any = CFB.find(cfb, "DocInfo");
    const recs = parseRecords(maybeInflate(new Uint8Array(e.content), compressed));
    let total = 0, faces = 0;
    for (const r of recs) {
      if (r.tagId === DocInfoTag.IdMappings) { const rd = new ByteReader(r.payload); rd.uint32(); for (let i = 0; i < 7; i++) total += rd.uint32(); }
      if (r.tagId === DocInfoTag.FaceName) faces++;
    }
    n++; if (total !== faces) { bad++; console.log("mismatch", f, total, faces); }
  } catch (e) { console.log("err", f, (e as Error).message); }
}
console.log({ n, bad });
