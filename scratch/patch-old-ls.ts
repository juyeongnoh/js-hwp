// 46B 문단 모양의 옛 줄 간격(오프셋 24)만 바꾼 양성 대조 파일.
import { readFileSync, writeFileSync } from 'node:fs'
import CFB from 'cfb'
import { parseRecords, serializeRecords, maybeInflate, maybeDeflate, DocInfoTag } from '../packages/hwp/src/index.ts'
const [input, output, idx, value] = process.argv.slice(2)
const c = CFB.read(readFileSync(input!), { type: 'buffer' })
const comp = ((CFB.find(c, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
const e = CFB.find(c, 'DocInfo')!
const recs = parseRecords(maybeInflate(new Uint8Array(e.content as any), comp))
const t = recs.filter((r) => r.tagId === DocInfoTag.ParaShape)[Number(idx)]!
new DataView(t.payload.buffer, t.payload.byteOffset).setInt32(24, Number(value), true)
e.content = maybeDeflate(serializeRecords(recs), comp) as any; e.size = (e.content as any).length
writeFileSync(output!, CFB.write(c, { type: 'buffer' }) as Uint8Array)
