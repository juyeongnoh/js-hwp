// DocInfo의 BIN_DATA(표 17) 페이로드와 BinData 스트림의 크기·앞 8바이트를 출력한다.
// 사용: npx tsx docs/experiments/scripts/dump-bindata.ts <파일>...
import { readFileSync } from 'node:fs'
import CFB from '../../../node_modules/cfb/cfb.js'
import { maybeInflate } from '../../../packages/hwp/src/compress.ts'
import { parseRecords } from '../../../packages/hwp/src/record.ts'
for (const f of process.argv.slice(2)) {
  const c = CFB.read(readFileSync(f), { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  console.log(f, 'compressed', compressed, 'ver', [...header.subarray(32,36)].reverse().join('.'))
  for (const p of c.FullPaths.filter((p) => /BinData/.test(p))) {
    const e = CFB.find(c, p.replace(/^[^/]*/, ''))!
    console.log('  ', p, e.content?.length, e.content ? Buffer.from(e.content as Uint8Array).subarray(0, 8).toString('hex') : '')
  }
  const di = maybeInflate(new Uint8Array(CFB.find(c, 'DocInfo')!.content as Uint8Array), compressed)
  for (const r of parseRecords(di)) if (r.tagId === 18 || r.tagId === 17) console.log('   tag', r.tagId, Buffer.from(r.payload).toString('hex').slice(0, 120))
}
