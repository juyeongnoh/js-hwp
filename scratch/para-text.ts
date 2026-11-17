import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { parseRecords, maybeInflate } from '../packages/hwp/src/index.ts'
const [file, want] = process.argv.slice(2)
const c = CFB.read(readFileSync(file!), { type: 'buffer' })
const comp = ((CFB.find(c, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
const ONE = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31])
for (const p of c.FullPaths) if (/Section\d+$/.test(p)) {
  const recs = parseRecords(maybeInflate(new Uint8Array(CFB.find(c, p)!.content as any), comp))
  let n = 0, cur = -1, lvl = 0
  for (const r of recs) {
    if (r.tagId === 66) { cur = new DataView(r.payload.buffer, r.payload.byteOffset).getUint16(8, true); lvl = r.level; n++; if (cur === Number(want)) console.log(`#${n} (lv${lvl}${lvl > 0 ? ', 표·글상자 안' : ''})`) }
    if (r.tagId === 67 && cur === Number(want)) {
      const v = new DataView(r.payload.buffer, r.payload.byteOffset); let s = ''
      for (let i = 0; i + 1 < r.payload.length;) { const u = v.getUint16(i, true); if (u >= 32) { s += String.fromCharCode(u); i += 2 } else { i += ONE.has(u) ? 2 : 16 } }
      console.log('   ', JSON.stringify(s.slice(0, 60)))
    }
  }
}
