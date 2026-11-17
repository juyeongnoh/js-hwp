import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { parseRecords, maybeInflate } from '../packages/hwp/src/index.ts'
const c = CFB.read(readFileSync(process.argv[2]!), { type: 'buffer' })
const comp = ((CFB.find(c, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
const st: Record<number, { paras: number; chars: number; lines: number; sample: string }> = {}
for (const p of c.FullPaths) if (/Section\d+$/.test(p)) {
  const recs = parseRecords(maybeInflate(new Uint8Array(CFB.find(c, p)!.content as any), comp))
  let cur = -1
  for (const r of recs) {
    const v = new DataView(r.payload.buffer, r.payload.byteOffset)
    if (r.tagId === 66) { cur = v.getUint16(8, true); st[cur] ??= { paras: 0, chars: 0, lines: 0, sample: '' }; st[cur].paras++ }
    if (r.tagId === 67) { let s = ''; for (let i = 0; i + 1 < r.payload.length; i += 2) { const u = v.getUint16(i, true); if (u >= 0xac00 && u <= 0xd7a3 || u === 32) s += String.fromCharCode(u) } st[cur]!.chars += s.length; if (s.length > st[cur]!.sample.length) st[cur]!.sample = s.slice(0, 40) }
    if (r.tagId === 69) st[cur]!.lines += r.payload.length / 36 // LINE_SEG 36B each
  }
}
Object.entries(st).sort((a, b) => b[1].lines - a[1].lines).slice(0, 8).forEach(([k, s]) => console.log(k, JSON.stringify(s)))
