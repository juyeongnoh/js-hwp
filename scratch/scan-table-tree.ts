import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { inflate, parseRecords, SectionTag, parseFileHeader } from '../packages/hwp/src/index.js'
import { buildRecordTree, type RecordNode } from '../packages/hwp/src/record.js'
const files = readFileSync(process.argv[2]!, 'utf8').trim().split(/\r?\n/)
const s: Record<string, number> = {}
const inc = (k: string) => (s[k] = (s[k] ?? 0) + 1)
let nfiles = 0
for (const f of files) {
  try {
    const cfb = CFB.read(readFileSync(f), { type: 'buffer' })
    const get = (p: string) => { const e = CFB.find(cfb, '/' + p); return e ? new Uint8Array(e.content as any) : undefined }
    const h = parseFileHeader(get('FileHeader')!)
    if (h.flags.passwordProtected || h.flags.distribution) continue
    let had = false
    const walk = (n: RecordNode, parent?: RecordNode) => {
      if (n.tagId === SectionTag.Table) inc(parent?.tagId === SectionTag.CtrlHeader && String.fromCharCode(parent.payload[3]!, parent.payload[2]!, parent.payload[1]!, parent.payload[0]!) === 'tbl ' ? 'TABLE under tbl CTRL_HEADER' : 'TABLE elsewhere')
      if (n.tagId === SectionTag.CtrlHeader && String.fromCharCode(n.payload[3]!, n.payload[2]!, n.payload[1]!, n.payload[0]!) === 'tbl ') {
        had = true
        const ti = n.children.findIndex((c) => c.tagId === SectionTag.Table)
        if (ti < 0) { inc('tbl without TABLE'); return }
        inc(n.children.filter((c) => c.tagId === SectionTag.Table).length === 1 ? 'one TABLE' : 'multi TABLE')
        const t = n.children[ti]!
        const v = new DataView(t.payload.buffer, t.payload.byteOffset, t.payload.byteLength)
        const rows = v.getUint16(4, true)
        let cells = 0; for (let r = 0; r < rows; r++) cells += v.getUint16(18 + 2 * r, true)
        const after = n.children.slice(ti + 1)
        const lh = after.filter((c) => c.tagId === SectionTag.ListHeader).length
        inc(lh === cells ? 'LIST_HEADER count = sum(Row Size)' : 'LIST_HEADER count != sum(Row Size)')
        inc(t.children.length === 0 ? 'TABLE has no children' : 'TABLE has children')
        const kinds = new Set(after.map((c) => c.tagId)); kinds.delete(SectionTag.ListHeader); kinds.delete(SectionTag.ParaHeader)
        inc(kinds.size === 0 ? 'after TABLE only LIST_HEADER/PARA_HEADER' : 'other tags after TABLE')
        inc(after[0]?.tagId === SectionTag.ListHeader ? 'first after TABLE is LIST_HEADER' : 'first after TABLE not LIST_HEADER')
      }
      n.children.forEach((c) => walk(c, n))
    }
    for (let i = 0; ; i++) {
      const sec = get('BodyText/Section' + i); if (!sec) break
      buildRecordTree(parseRecords(h.flags.compressed ? inflate(sec) : sec)).forEach((n) => walk(n))
    }
    if (had) nfiles++
  } catch { inc('err') }
}
console.log(nfiles, 'files', s)
