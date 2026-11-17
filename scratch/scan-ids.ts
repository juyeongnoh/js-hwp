import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import CFB from 'cfb'
import { inflate, parseRecords, DocInfoTag, parseFileHeader } from '../packages/hwp/src/index.js'
const files = execSync("find . ../rhwp ../hwp-test $HOME/Downloads/kogl_type1 -name '*.hwp' -not -path '*/node_modules/*' 2>/dev/null").toString().trim().split('\n')
const s: Record<string, number> = {}
const inc = (k: string) => (s[k] = (s[k] ?? 0) + 1)
const lens: Record<number, number> = {}
for (const f of files) {
  try {
    const cfb = CFB.read(readFileSync(f), { type: 'buffer' })
    const get = (p: string) => new Uint8Array(CFB.find(cfb, '/' + p)!.content as any)
    const h = parseFileHeader(get('FileHeader'))
    if (h.flags.passwordProtected || h.flags.distribution) continue
    const d = get('DocInfo'); const recs = parseRecords(h.flags.compressed ? inflate(d) : d)
    const n = (t: number) => recs.filter(r => r.tagId === t).length
    const nTab = n(DocInfoTag.TabDef), nNum = n(DocInfoTag.Numbering), nBul = n(DocInfoTag.Bullet), nBf = n(DocInfoTag.BorderFill)
    for (const r of recs) {
      if (r.tagId !== DocInfoTag.ParaShape) continue
      lens[r.payload.length] = (lens[r.payload.length] ?? 0) + 1
      const v = new DataView(r.payload.buffer, r.payload.byteOffset, r.payload.length)
      const p1 = v.getUint32(0, true), kind = (p1 >>> 23) & 3, id = v.getUint16(30, true), bf = v.getUint16(32, true)
      if (kind === 2 || kind === 3) {
        const cnt = kind === 2 ? nNum : nBul
        inc(`${kind === 2 ? 'num' : 'bul'} id=0:${id === 0} id>cnt:${id > cnt} id==cnt:${id === cnt}`)
      }
      if (kind === 1) inc(`outline id=${id}`)
      inc(`align=${(p1>>>2)&7}`); inc(`latin=${(p1>>>5)&3}`); inc(`valign=${(p1>>>20)&3}`)
      const tab = v.getUint16(28, true); inc(`tab >=cnt:${tab >= nTab} ==cnt-1:${tab === nTab - 1}`)
      if (bf !== 0) inc(`borderFill bf>cnt:${bf > nBf} bf==cnt:${bf === nBf}`)
      if (bf === 0 && ((p1 >>> 28) & 3)) inc('bf=0 but connect/ignore')
      const b915 = (p1 >>> 9) & 0x7f
      if (b915) inc(`bits9-15=${b915.toString(2)}`)
      if (p1 >>> 30) inc(`bits30-31=${p1 >>> 30}`)
      if (r.payload.length >= 54) { const k3 = v.getUint32(46, true) & 0x1f; if (k3 > 3) inc(`newkind=${k3}`); const p3hi = v.getUint32(46, true) >>> 5; if (p3hi) inc(`p3 high=${p3hi}`) }
      const p2 = v.getUint32(42, true); inc(`len=${r.payload.length} p2&3=${p2 & 3} bit3=${(p2 >>> 3) & 1}`)
    }
  } catch {}
}
console.log(files.length, lens); console.log(Object.entries(s).sort((a, b) => b[1] - a[1]).slice(0, 40))
