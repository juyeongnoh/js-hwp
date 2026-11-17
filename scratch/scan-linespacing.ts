import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import CFB from 'cfb'
import { inflate, parseRecords, DocInfoTag, parseFileHeader } from '../packages/hwp/src/index.js'
const files = execSync("find . ../rhwp ../hwp-test $HOME/Downloads/kogl_type1 -name '*.hwp' -not -path '*/node_modules/*' 2>/dev/null").toString().trim().split('\n')
const stats: Record<string, number> = {}
const ex: Record<string, string> = {}
for (const f of files) {
  try {
    const cfb = CFB.read(readFileSync(f), { type: 'buffer' })
    const get = (p: string) => new Uint8Array(CFB.find(cfb, '/' + p)!.content as any)
    const h = parseFileHeader(get('FileHeader'))
    if (h.flags.passwordProtected || h.flags.distribution) continue
    const d = get('DocInfo'); const recs = parseRecords(h.flags.compressed ? inflate(d) : d)
    const gen = f.includes('rhwp') ? 'rhwp' : 'other'
    for (const r of recs) {
      if (r.tagId !== DocInfoTag.ParaShape || r.payload.length < 54) continue
      const v = new DataView(r.payload.buffer, r.payload.byteOffset, r.payload.length)
      const oldK = v.getUint32(0, true) & 3, oldV = v.getInt32(24, true)
      const newK = v.getUint32(46, true) & 31, newV = v.getUint32(50, true)
      const rel = oldK === newK && oldV === newV ? 'same' : `old=${oldK}/${oldV}`
      const key = `${gen} new=${newK} ${rel}${newK === 3 ? " newV=" + newV : ""}`
      stats[key] = (stats[key] ?? 0) + 1
      ex[key] ??= `${f} newV=${newV}`
    }
  } catch { stats.err = (stats.err ?? 0) + 1 }
}
console.log(files.length, 'files')
for (const k of Object.keys(stats).sort()) console.log(stats[k], k, '  e.g.', ex[k])
