// 저장소 HWP의 표마다 TABLE 속성 bit 3, 24, 25, 26과 셀 속성 OR·AND, 병합, 셀 크기, 글자처럼 취급 등의 교차표를 출력한다.
// 사용: npx tsx scratch/scan-table-bits-corr.ts <HWP 경로 목록 파일>
import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { parseRecords, SectionTag, parseFileHeader } from '../packages/hwp/src/index.js'
import { maybeInflate } from '../packages/hwp/src/compress.js'
import { buildRecordTree, type RecordNode } from '../packages/hwp/src/record.js'
const files = readFileSync(process.argv[2]!, 'utf8').trim().split(/\r?\n/)
const isTbl = (n: RecordNode) => n.tagId === SectionTag.CtrlHeader && String.fromCharCode(n.payload[3]!, n.payload[2]!, n.payload[1]!, n.payload[0]!) === 'tbl '
type Row = Record<string, number>
const rows: Row[] = []
for (const f of files) { try {
  const c = CFB.read(readFileSync(f), { type: 'buffer' })
  const h = parseFileHeader(new Uint8Array(CFB.find(c, 'FileHeader')!.content as any)); if (h.flags.passwordProtected || h.flags.distribution) continue
  const walk = (n: RecordNode) => {
    if (isTbl(n)) {
      const t = n.children.find((x) => x.tagId === SectionTag.Table)!
      const tv = new DataView(t.payload.buffer, t.payload.byteOffset, t.payload.byteLength)
      const tp = tv.getUint32(0, true), nrows = tv.getUint16(4, true), ncols = tv.getUint16(6, true)
      let orP = 0, andP = 0xffffffff, merged = 0, widths = new Set<number>(), heights = new Set<number>(), cells = 0
      for (const lh of n.children.filter((x) => x.tagId === SectionTag.ListHeader).slice(t === n.children[0] ? 0 : 0)) {
        if (n.children.indexOf(lh) < n.children.indexOf(t)) continue
        const v = new DataView(lh.payload.buffer, lh.payload.byteOffset, lh.payload.byteLength)
        const p = v.getUint32(4, true); orP |= p; andP &= p; cells++
        if (v.getUint16(12, true) > 1 || v.getUint16(14, true) > 1) merged = 1
        widths.add(v.getUint32(16, true)); heights.add(v.getUint32(20, true))
      }
      const op = new DataView(n.payload.buffer, n.payload.byteOffset).getUint32(4, true)
      rows.push({ b3: (tp >> 3) & 1, b24: (tp >> 24) & 1, b25: (tp >> 25) & 1, b26: (tp >> 26) & 1,
        c16: (orP >> 16) & 1, c17: (orP >> 17) & 1, c18: (orP >> 18) & 1, c19: (orP >> 19) & 1, c20: (orP >> 20) & 1, c24: (orP >>> 24) & 1, c26: (orP >>> 26) & 1,
        a24: (andP >>> 24) & 1, a26: (andP >>> 26) & 1, merged, unevenW: widths.size > 1 ? 1 : 0, unevenH: heights.size > 1 ? 1 : 0,
        caption: (op >>> 29) & 1, asChar: op & 1, single: cells === 1 ? 1 : 0 })
    }
    n.children.forEach(walk)
  }
  for (const p of c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p)))
    buildRecordTree(parseRecords(maybeInflate(new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as any), h.flags.compressed))).forEach(walk)
} catch {} }
console.log('tables', rows.length)
const feats = Object.keys(rows[0]!).filter((k) => !/^b\d/.test(k))
for (const b of ['b3', 'b24', 'b25', 'b26']) {
  const out: string[] = []
  for (const k of feats) {
    let tt = 0, tf = 0, ft = 0, ff = 0
    for (const r of rows) { if (r[b]) { if (r[k]) tt++; else tf++ } else { if (r[k]) ft++; else ff++ } }
    out.push(`${k}: on→${tt}/${tt + tf} off→${ft}/${ft + ff}`)
  }
  console.log(b, '\n  ' + out.join('\n  '))
}
