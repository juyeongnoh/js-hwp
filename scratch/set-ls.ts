// 문단 모양 하나의 옛 칸(종류·값)과 새 칸(종류·값)을 직접 지정한다. 46B면 58B로 늘린다.
import { readFileSync, writeFileSync } from 'node:fs'
import CFB from 'cfb'
import { parseRecords, serializeRecords, maybeInflate, maybeDeflate, DocInfoTag } from '../packages/hwp/src/index.ts'
const [input, output, idx, ok, ov, nk, nv] = process.argv.slice(2).map((s, i) => i < 2 ? s : s) as string[]
const c = CFB.read(readFileSync(input!), { type: 'buffer' })
const comp = ((CFB.find(c, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
const e = CFB.find(c, 'DocInfo')!
const recs = parseRecords(maybeInflate(new Uint8Array(e.content as any), comp))
const t = recs.filter((r) => r.tagId === DocInfoTag.ParaShape)[Number(idx)]!
if (t.payload.length === 46) { const out = new Uint8Array(58); out.set(t.payload); t.payload = out; const v = new DataView(out.buffer); v.setUint32(54, (v.getUint32(0, true) >>> 25) & 7, true) }
const v = new DataView(t.payload.buffer, t.payload.byteOffset, t.payload.length)
v.setUint32(0, (v.getUint32(0, true) & ~3) | Number(ok), true)
v.setInt32(24, Number(ov), true)
v.setUint32(46, (v.getUint32(46, true) & ~31) | Number(nk), true)
v.setUint32(50, Number(nv), true)
e.content = maybeDeflate(serializeRecords(recs), comp) as any; e.size = (e.content as any).length
writeFileSync(output!, CFB.write(c, { type: 'buffer' }) as Uint8Array)
console.log(output, Buffer.from(t.payload).toString('hex'))
