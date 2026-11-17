import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import CFB from 'cfb'
import { inflate, parseRecords, DocInfoTag, parseFileHeader } from '../packages/hwp/src/index.js'
const files = execSync("find . ../rhwp ../hwp-test $HOME/Downloads/kogl_type1 -name '*.hwp' -not -path '*/node_modules/*' 2>/dev/null").toString().trim().split('\n')
const stats: Record<string, number> = {}
for (const f of files) {
  try {
    const cfb = CFB.read(readFileSync(f), { type: 'buffer' })
    const get = (p: string) => new Uint8Array(CFB.find(cfb, '/' + p)!.content as any)
    const h = parseFileHeader(get('FileHeader'))
    if (h.flags.passwordProtected || h.flags.distribution) continue
    const d = get('DocInfo'); const recs = parseRecords(h.flags.compressed ? inflate(d) : d)
    for (const r of recs) {
      if (r.tagId !== DocInfoTag.ParaShape || r.payload.length !== 46) continue
      const v = new DataView(r.payload.buffer, r.payload.byteOffset, 46)
      const k = `kind=${v.getUint32(0, true) & 3} value=${v.getInt32(24, true)}`
      stats[k] = (stats[k] ?? 0) + 1
    }
  } catch {}
}
console.log(stats)
