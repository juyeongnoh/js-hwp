import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { inflate, parseRecords, DocInfoTag, SectionTag, parseFileHeader } from '../packages/hwp/src/index.js'

const cfb = CFB.read(readFileSync(process.argv[2]!), { type: 'buffer' })
const get = (p: string) => new Uint8Array(CFB.find(cfb, '/' + p)!.content as any)
const header = parseFileHeader(get('FileHeader'))
const z = (b: Uint8Array) => (header.flags.compressed ? inflate(b) : b)
const recs = parseRecords(z(get('DocInfo')))
let i = 0
for (const r of recs) {
  if (r.tagId !== DocInfoTag.ParaShape) continue
  const v = new DataView(r.payload.buffer, r.payload.byteOffset, r.payload.byteLength)
  const p1 = v.getUint32(0, true)
  const kind = (p1 >>> 23) & 3, lvl = (p1 >>> 25) & 7
  const id = v.getUint16(30, true)
  const tail = r.payload.length >= 58 ? v.getUint32(54, true) : '-'
  if (kind || lvl || tail) console.log(`PS ${i}: kind=${kind} lvl3=${lvl} headingId=${id} off54=${tail} len=${r.payload.length}`)
  i++
}
const sec = parseRecords(z(get('BodyText/Section0')))
for (const r of sec) if (r.tagId === SectionTag.ParaHeader)
  console.log('para paraShapeId', new DataView(r.payload.buffer, r.payload.byteOffset).getUint16(8, true))
