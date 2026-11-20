// 첫 구역의 표 셀 LIST_HEADER마다 셀 주소, 첫 문단 텍스트 없이 순번, 속성 UINT32(오프셋 4)와 켜진 비트,
// 셀 필드(34B) 뒤 바이트를 출력한다.
// 사용: npx tsx docs/experiments/scripts/dump-cell-list-props.ts <파일>
import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { parseRecords } from '../../../packages/hwp/src/record.ts'
import { maybeInflate } from '../../../packages/hwp/src/compress.ts'
import { SectionTag } from '../../../packages/hwp/src/tags.ts'

const [path] = process.argv.slice(2) as [string]
const container = CFB.read(readFileSync(path), { type: 'buffer' })
const compressed = ((CFB.find(container, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
const data = maybeInflate(new Uint8Array(CFB.find(container, '/BodyText/Section0')!.content as Uint8Array), compressed)
let i = 0
for (const r of parseRecords(data)) {
  if (r.tagId !== SectionTag.ListHeader || r.payload.length < 34) continue
  const v = new DataView(r.payload.buffer, r.payload.byteOffset, r.payload.length)
  const props = v.getUint32(4, true)
  const bits = [...Array(32).keys()].filter((b) => (props >>> b) & 1)
  const margins = [24, 26, 28, 30].map((o) => v.getUint16(o, true)).join(',')
  const tail = Buffer.from(r.payload.subarray(34)).toString('hex')
  console.log(`c${i++} col=${v.getUint16(8, true)} row=${v.getUint16(10, true)} props=0x${props.toString(16).padStart(8, '0')} bits=[${bits}] margins=${margins} tail=${tail} (${r.payload.length}B)`)
}
