import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { inflate, parseRecords, DocInfoTag, parseFileHeader } from '../packages/hwp/src/index.js'
const cfb = CFB.read(readFileSync(process.argv[2]!), { type: 'buffer' })
const get = (p: string) => new Uint8Array(CFB.find(cfb, '/' + p)!.content as any)
const h = parseFileHeader(get('FileHeader'))
console.log('version', h.version, 'flags', h.flags)
const d = get('DocInfo'); const recs = parseRecords(h.flags.compressed ? inflate(d) : d)
const lens: Record<number, number> = {}
for (const r of recs) if (r.tagId === DocInfoTag.ParaShape) {
  lens[r.payload.length] = (lens[r.payload.length] ?? 0) + 1
  const v = new DataView(r.payload.buffer, r.payload.byteOffset, r.payload.length)
  const p1 = v.getUint32(0, true)
  if (r.payload.length >= 58 || ((p1 >>> 23) & 3)) console.log('kind', (p1 >>> 23) & 3, 'lvl3', (p1 >>> 25) & 7, 'off54', r.payload.length >= 58 ? v.getUint32(54, true) : '-')
}
console.log('ParaShape lengths', lens)
const num = recs.filter((r) => r.tagId === DocInfoTag.Numbering).map((r) => r.payload.length)
console.log('Numbering lengths', num)
