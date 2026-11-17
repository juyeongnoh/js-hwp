import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import CFB from 'cfb'
import { inflate, parseRecords, DocInfoTag, parseFileHeader } from '../packages/hwp/src/index.js'
const files = execSync("find . ../rhwp ../hwp-test -name '*.hwp' -not -path '*/node_modules/*' 2>/dev/null").toString().trim().split('\n')
const stats: Record<string, number> = {}
const bad: string[] = []
for (const f of files) {
  try {
    const cfb = CFB.read(readFileSync(f), { type: 'buffer' })
    const get = (p: string) => new Uint8Array(CFB.find(cfb, '/' + p)!.content as any)
    const h = parseFileHeader(get('FileHeader'))
    if (h.flags.passwordProtected || h.flags.distribution) continue
    const d = get('DocInfo'); const recs = parseRecords(h.flags.compressed ? inflate(d) : d)
    for (const r of recs) {
      if (r.tagId !== DocInfoTag.ParaShape) continue
      const len = r.payload.length
      stats['len' + len] = (stats['len' + len] ?? 0) + 1
      if (len < 58) continue
      const v = new DataView(r.payload.buffer, r.payload.byteOffset, len)
      const lvl3 = (v.getUint32(0, true) >>> 25) & 7, off = v.getUint32(54, true)
      const key = `lvl3=${lvl3},off54=${off}`
      stats[key] = (stats[key] ?? 0) + 1
      if (lvl3 !== Math.min(off, 6)) bad.push(`${f} ${key}`)
    }
  } catch (e) { stats.err = (stats.err ?? 0) + 1 }
}
console.log(files.length, 'files'); console.log(stats); console.log('mismatch', bad.length, bad.slice(0, 10))
