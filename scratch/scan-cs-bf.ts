import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import CFB from 'cfb'
import { inflate, parseRecords, DocInfoTag, parseFileHeader } from '../packages/hwp/src/index.js'
const files = execSync("find . ../rhwp ../hwp-test $HOME/Downloads/kogl_type1 -name '*.hwp' -not -path '*/node_modules/*' 2>/dev/null").toString().trim().split('\n')
const s: Record<string, number> = {}
for (const f of files) {
  try {
    const cfb = CFB.read(readFileSync(f), { type: 'buffer' })
    const get = (p: string) => new Uint8Array(CFB.find(cfb, '/' + p)!.content as any)
    const h = parseFileHeader(get('FileHeader'))
    if (h.flags.passwordProtected || h.flags.distribution) continue
    const d = get('DocInfo'); const recs = parseRecords(h.flags.compressed ? inflate(d) : d)
    const nBf = recs.filter(r => r.tagId === DocInfoTag.BorderFill).length
    for (const r of recs) {
      if (r.tagId !== DocInfoTag.CharShape) continue
      if (r.payload.length < 70) { s['short'] = (s['short'] ?? 0) + 1; continue }
      const bf = new DataView(r.payload.buffer, r.payload.byteOffset).getUint16(68, true)
      const k = bf === 0 ? 'zero' : bf > nBf ? 'over' : bf === nBf ? 'eqcnt' : 'in'
      s[k] = (s[k] ?? 0) + 1
    }
  } catch {}
}
console.log(s)
