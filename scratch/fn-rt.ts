import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as CFB from "cfb";
import { maybeInflate, parseRecords, parseHwp, serializeHwp, DocInfoTag } from "@js-hwp/hwp";
const walk = (d: string): string[] => statSync(d).isFile() ? [d] : readdirSync(d).flatMap((f) => walk(join(d, f))).filter((p) => p.endsWith(".hwp"));
const recs = (buf: Uint8Array) => {
  const cfb = CFB.read(buf, { type: "buffer" });
  const comp = ((CFB.find(cfb, "FileHeader") as any).content[36] & 1) === 1;
  return parseRecords(maybeInflate(new Uint8Array((CFB.find(cfb, "DocInfo") as any).content), comp));
};
const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");
const TAGS = [DocInfoTag.FaceName, DocInfoTag.CharShape];
let ok = 0, bad = 0;
for (const f of process.argv.slice(2).flatMap(walk)) {
  try {
    const src = new Uint8Array(readFileSync(f));
    const a = recs(src), b = recs(serializeHwp(parseHwp(src)));
    const diffs: string[] = [];
    for (const t of TAGS) {
      const x = a.filter((r) => r.tagId === t).map((r) => hex(r.payload)), y = b.filter((r) => r.tagId === t).map((r) => hex(r.payload));
      if (x.length !== y.length) diffs.push(`tag ${t} count ${x.length}→${y.length}`);
      else x.forEach((v, i) => v !== y[i] && diffs.push(`tag ${t} #${i}`));
    }
    const im = (rs: any[]) => hex(rs.find((r) => r.tagId === DocInfoTag.IdMappings).payload.slice(4, 32));
    if (im(a) !== im(b)) diffs.push("IdMappings font counts");
    if (diffs.length) { bad++; console.log(f, diffs.slice(0, 4).join("; "), diffs.length); } else ok++;
  } catch (e) { console.log("err", f, (e as Error).message); }
}
console.log({ ok, bad });
