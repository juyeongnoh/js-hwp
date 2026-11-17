import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { parseRecords, maybeInflate, DocInfoTag } from '../packages/hwp/src/index.ts'
const c = CFB.read(readFileSync(process.argv[2]!), { type: 'buffer' })
const comp = ((CFB.find(c, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
const doc = parseRecords(maybeInflate(new Uint8Array(CFB.find(c, 'DocInfo')!.content as any), comp))
const ps = doc.filter((r) => r.tagId === DocInfoTag.ParaShape)
const use: Record<number, number> = {}
for (const p of c.FullPaths) if (/Section\d+$/.test(p)) {
  const recs = parseRecords(maybeInflate(new Uint8Array(CFB.find(c, p)!.content as any), comp))
  for (const r of recs) if (r.tagId === 66) { const id = new DataView(r.payload.buffer, r.payload.byteOffset).getUint16(8, true); use[id] = (use[id] ?? 0) + 1 }
}
ps.forEach((r, i) => { const v = new DataView(r.payload.buffer, r.payload.byteOffset); console.log(i, r.payload.length, 'kind', v.getUint32(0, true) & 3, 'ls', v.getInt32(24, true), 'used', use[i] ?? 0) })
