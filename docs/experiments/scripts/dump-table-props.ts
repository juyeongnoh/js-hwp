// 사용: npx tsx docs/experiments/scripts/dump-table-props.ts <hwp 파일>...
// 각 파일의 TABLE 레코드 속성(표 76)과 셀 LIST_HEADER(34B 이상)의 리스트 속성을 출력한다.
import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { parseRecords, SectionTag, parseFileHeader } from '../../../packages/hwp/src/index.ts'
import { maybeInflate } from '../../../packages/hwp/src/compress.ts'
const hex = (v: number) => '0x' + v.toString(16).padStart(8, '0')
for (const f of process.argv.slice(2)) {
  const c = CFB.read(readFileSync(f), { type: 'buffer' })
  const h = parseFileHeader(new Uint8Array(CFB.find(c, 'FileHeader')!.content as any))
  const out: string[] = []
  for (const p of c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p)))
    for (const r of parseRecords(maybeInflate(new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as any), h.flags.compressed))) {
      const dv = new DataView(r.payload.buffer, r.payload.byteOffset, r.payload.byteLength)
      if (r.tagId === SectionTag.ListHeader && r.payload.length >= 34) out.push('cell ' + hex(dv.getUint32(4, true)))
      if (r.tagId !== SectionTag.Table) continue
      const v = dv.getUint32(0, true)
      out.push('TABLE ' + hex(v) + ' bits[' + [...Array(32).keys()].filter((b) => (v >>> b) & 1).join(',') + ']')
    }
  console.log(f.split(/[\/]/).pop(), out.join(' | '))
}
