import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { inflate, parseRecords, DocInfoTag, parseFileHeader } from '../packages/hwp/src/index.js'
import { parseHwp, serializeHwp } from '../packages/hwp/src/document.js'
const ps = (b: Uint8Array) => { const c = CFB.read(b, { type: 'buffer' }); const g = (p: string) => new Uint8Array(CFB.find(c, '/' + p)!.content as any); const h = parseFileHeader(g('FileHeader')); const d = g('DocInfo'); return parseRecords(h.flags.compressed ? inflate(d) : d).filter(r => r.tagId === DocInfoTag.ParaShape).map(r => r.payload) }
const dir = 'scratch/parashape-46-with-58/'
const ours = ps(serializeHwp(parseHwp(new Uint8Array(readFileSync(dir + '58-old-between6-new-pct300.hwp')))))
const hangul = ps(new Uint8Array(readFileSync(dir + 'save-test-between6.hwp')))
let same = 0, diff = 0
ours.forEach((o, i) => {
  const h = hangul[i]!
  if (o.length === h.length && o.every((x, k) => x === h[k])) { same++; return }
  diff++
  const n = Math.min(o.length, h.length)
  const d = []; for (let k = 0; k < n; k++) if (o[k] !== h[k]) d.push(`${k}:${o[k]}/${h[k]}`)
  if (i === 16 || diff <= 2) console.log('#' + i, o.length + 'B vs ' + h.length + 'B', d.join(' ') || '(앞부분 같음)')
})
console.log({ same, diff })
