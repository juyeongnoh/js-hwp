// 개체 컨트롤(`tbl `, `gso ` 등) CTRL_HEADER의 개체 공통 속성(표 69, 70)을 바이트에서 직접 풀어 출력한다.
// 코덱을 거치지 않는다. 길이(HWPUNIT)는 mm로도 보인다(7200 HWPUNIT = 1 inch = 25.4 mm).
// 사용: npx tsx docs/experiments/scripts/dump-object-common.ts <파일>...
import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { buildRecordTree, parseRecords, type RecordNode } from '../../../packages/hwp/src/record.ts'
import { maybeInflate } from '../../../packages/hwp/src/compress.ts'
import { SectionTag } from '../../../packages/hwp/src/tags.ts'

const OBJECTS = new Set(['tbl ', 'gso ', 'eqed'])
const mm = (v: number): string => `${v} (${((v * 25.4) / 7200).toFixed(2)}mm)`
const bits = (v: number, from: number, to: number): number => (v >>> from) & ((1 << (to - from + 1)) - 1)

function dump(p: Uint8Array): void {
  const v = new DataView(p.buffer, p.byteOffset, p.byteLength)
  const id = String.fromCharCode(p[3]!, p[2]!, p[1]!, p[0]!)
  const props = v.getUint32(4, true)
  console.log(`  CTRL_HEADER '${id}' ${p.length}B`)
  console.log(`    속성 0x${props.toString(16).padStart(8, '0')}`)
  console.log(`      bit 0 글자처럼=${bits(props, 0, 0)} bit 1 예약=${bits(props, 1, 1)} bit 2 줄간격영향=${bits(props, 2, 2)}`)
  console.log(`      bit 3-4 세로기준=${bits(props, 3, 4)} bit 5-7 세로정렬=${bits(props, 5, 7)} bit 8-9 가로기준=${bits(props, 8, 9)} bit 10-12 가로정렬=${bits(props, 10, 12)}`)
  console.log(`      bit 13 본문영역제한=${bits(props, 13, 13)} bit 14 겹침허용=${bits(props, 14, 14)} bit 15-17 폭기준=${bits(props, 15, 17)} bit 18-19 높이기준=${bits(props, 18, 19)}`)
  console.log(`      bit 20 크기보호=${bits(props, 20, 20)} bit 21-23 배치=${bits(props, 21, 23)} bit 24-25 글위치=${bits(props, 24, 25)} bit 26-28 번호범주=${bits(props, 26, 28)} bit 29-31=${bits(props, 29, 31)}`)
  console.log(`    세로 오프셋 ${mm(v.getInt32(8, true))}, 가로 오프셋 ${mm(v.getInt32(12, true))}`)
  console.log(`    폭 ${mm(v.getUint32(16, true))}, 높이 ${mm(v.getUint32(20, true))}, z-order ${v.getInt32(24, true)}`)
  const margins = [0, 1, 2, 3].map((i) => mm(v.getInt16(28 + i * 2, true)))
  console.log(`    바깥 여백(왼·오·위·아래) ${margins.join(', ')}`)
  console.log(`    인스턴스 ID 0x${v.getUint32(36, true).toString(16)}`)
  if (p.length >= 44) console.log(`    쪽나눔 방지 ${v.getInt32(40, true)}`)
  if (p.length >= 46) {
    const len = v.getUint16(44, true)
    let text = ''
    for (let i = 0; i < len && 46 + i * 2 + 1 < p.length; i++) text += String.fromCharCode(v.getUint16(46 + i * 2, true))
    console.log(`    설명문 길이 ${len} "${text}"`)
    const end = 46 + len * 2
    if (p.length > end) console.log(`    뒤에 남는 바이트 ${p.length - end}B ${Buffer.from(p.subarray(end)).toString('hex')}`)
  }
}

for (const path of process.argv.slice(2)) {
  const container = CFB.read(readFileSync(path), { type: 'buffer' })
  const compressed = ((CFB.find(container, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
  console.log(`== ${path}`)
  const walk = (node: RecordNode): void => {
    if (node.tagId === SectionTag.CtrlHeader && OBJECTS.has(String.fromCharCode(node.payload[3]!, node.payload[2]!, node.payload[1]!, node.payload[0]!)))
      dump(node.payload)
    node.children.forEach(walk)
  }
  for (const stream of container.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p))) {
    const data = new Uint8Array(CFB.find(container, stream.replace(/^[^/]*/, ''))!.content as Uint8Array)
    buildRecordTree(parseRecords(maybeInflate(data, compressed))).forEach(walk)
  }
}
