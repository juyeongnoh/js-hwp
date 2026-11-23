import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import CFB from 'cfb'
import { inflate, parseRecords, DocInfoTag, SectionTag, parseFileHeader } from '../packages/hwp/src/index.js'
const files = readFileSync(process.argv[2]!, 'utf8').trim().split(/\r?\n/)
const s: Record<string, number> = {}
const inc = (k: string) => (s[k] = (s[k] ?? 0) + 1)
const ex: string[] = []
for (const f of files) {
  try {
    const cfb = CFB.read(readFileSync(f), { type: 'buffer' })
    const get = (p: string) => { const e = CFB.find(cfb, '/' + p); return e ? new Uint8Array(e.content as any) : undefined }
    const h = parseFileHeader(get('FileHeader')!)
    if (h.flags.passwordProtected || h.flags.distribution) continue
    const d = get('DocInfo')!; const recs = parseRecords(h.flags.compressed ? inflate(d) : d)
    const nBf = recs.filter(r => r.tagId === DocInfoTag.BorderFill).length
    for (let i = 0; ; i++) {
      const sec = get('BodyText/Section' + i); if (!sec) break
      for (const r of parseRecords(h.flags.compressed ? inflate(sec) : sec)) {
        if (r.tagId !== SectionTag.Table) continue
        const p = r.payload; const v = new DataView(p.buffer, p.byteOffset, p.byteLength)
        const rows = v.getUint16(4, true); const cols = v.getUint16(6, true)
        const base = 18 + 2 * rows + 2
        if (p.length < base + 2) { inc(`no zone field len=${p.length - base}`); continue }
        const n = v.getUint16(base, true)
        const rest = p.length - base - 2 - 10 * n
        inc(`rest=${rest}`)
        inc(n === 0 ? 'zones=0' : 'zones>0')
        for (let z = 0; z < n && base + 2 + 10 * z + 10 <= p.length; z++) {
          const o = base + 2 + 10 * z
          const [sc, sr, ec, er, bf] = [0, 2, 4, 6, 8].map(k => v.getUint16(o + k, true))
          inc(bf === 0 ? 'bf=0' : bf > nBf ? 'bf>count' : bf === nBf ? 'bf=count' : 'bf in')
          if (ec >= cols || er >= rows) inc('end out of table')
          if (sc > ec || sr > er) inc('start>end')
          if (ex.length < 8) ex.push(`${f} v${h.version} ${rows}x${cols} zone ${sc},${sr}-${ec},${er} bf=${bf}/${nBf}`)
        }
      }
    }
  } catch (e) { inc('err') }
}
console.log(s); console.log(ex.join('\n'))
