import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { inflate, parseRecords, DocInfoTag, parseFileHeader } from '../packages/hwp/src/index.js'
for (const f of process.argv.slice(2)) {
  const cfb = CFB.read(readFileSync(f), { type: 'buffer' })
  const get = (p: string) => new Uint8Array(CFB.find(cfb, '/' + p)!.content as any)
  const h = parseFileHeader(get('FileHeader'))
  const d = get('DocInfo'); const recs = parseRecords(h.flags.compressed ? inflate(d) : d).filter(r => r.tagId === DocInfoTag.ParaShape)
  const lens: Record<number, number> = {}
  for (const r of recs) lens[r.payload.length] = (lens[r.payload.length] ?? 0) + 1
  console.log(f.split('/').pop(), 'version', JSON.stringify(h.version), 'count', recs.length, 'lens', JSON.stringify(lens))
  recs.forEach((r, i) => {
    const v = new DataView(r.payload.buffer, r.payload.byteOffset, r.payload.length)
    const old = `${v.getUint32(0, true) & 3}/${v.getInt32(24, true)}`
    const nw = r.payload.length >= 54 ? `${v.getUint32(46, true) & 0x1f}/${v.getUint32(50, true)}` : '-'
    if (i === 16 || old !== nw.replace('-', old)) console.log('  #' + i, r.payload.length + 'B', 'old', old, 'new', nw)
  })
}
