import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { inflate, parseRecords, SectionTag, parseFileHeader } from '../packages/hwp/src/index.js'
const files = readFileSync(process.argv[2]!, 'utf8').trim().split(/\r?\n/)
const vals: Record<string, number> = {}
const bitsCount: Record<number, number> = {}
const ex: Record<string, string> = {}
for (const f of files) {
  try {
    const cfb = CFB.read(readFileSync(f), { type: 'buffer' })
    const get = (p: string) => { const e = CFB.find(cfb, '/' + p); return e ? new Uint8Array(e.content as any) : undefined }
    const h = parseFileHeader(get('FileHeader')!)
    if (h.flags.passwordProtected || h.flags.distribution) continue
    for (let i = 0; ; i++) {
      const sec = get('BodyText/Section' + i); if (!sec) break
      for (const r of parseRecords(h.flags.compressed ? inflate(sec) : sec)) {
        if (r.tagId !== SectionTag.Table) continue
        const v = new DataView(r.payload.buffer, r.payload.byteOffset).getUint32(0, true)
        const k = '0x' + v.toString(16).padStart(8, '0')
        vals[k] = (vals[k] ?? 0) + 1
        ex[k] ??= f
        for (let b = 0; b < 32; b++) if (v & (1 << b)) bitsCount[b] = (bitsCount[b] ?? 0) + 1
      }
    }
  } catch {}
}
console.log(vals); console.log(bitsCount); console.log(ex)
