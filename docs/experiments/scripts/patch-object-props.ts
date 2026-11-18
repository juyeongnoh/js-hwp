// 첫 구역에서 처음 나오는 개체(`gso `, `tbl `, `eqed`) CTRL_HEADER의 속성(오프셋 4, UINT32)에서
// 비트 범위 하나를 바꿔 새 파일로 저장한다. 코덱을 거치지 않고 원시 레코드만 고친다. 다시 읽어 그 레코드
// 말고는 Section0 레코드와 다른 스트림이 기반과 같은지 확인한다.
// 사용: npx tsx docs/experiments/scripts/patch-object-props.ts <기반> <출력> <ctrlId> <시작 비트> <끝 비트> <값>
import { readFileSync, writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import CFB from 'cfb'
import { parseRecords, serializeRecords, type HwpRecord } from '../../../packages/hwp/src/record.ts'
import { maybeInflate, maybeDeflate } from '../../../packages/hwp/src/compress.ts'
import { SectionTag } from '../../../packages/hwp/src/tags.ts'

const [input, output, ctrlId, ...nums] = process.argv.slice(2) as [string, string, string, string, string, string]
const [start, end, value] = nums.map(Number) as [number, number, number]
const STREAM = '/BodyText/Section0'

function open(path: string) {
  const container = CFB.read(readFileSync(path), { type: 'buffer' })
  const compressed = ((CFB.find(container, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
  const entry = CFB.find(container, STREAM)!
  const records = parseRecords(maybeInflate(new Uint8Array(entry.content as Uint8Array), compressed))
  const target = records.find(
    (r) => r.tagId === SectionTag.CtrlHeader && String.fromCharCode(r.payload[3]!, r.payload[2]!, r.payload[1]!, r.payload[0]!) === ctrlId,
  )!
  return { container, compressed, entry, records, target }
}

const props = (record: HwpRecord): number => new DataView(record.payload.buffer, record.payload.byteOffset).getUint32(4, true)

function patch(record: HwpRecord) {
  const payload = record.payload.slice()
  const view = new DataView(payload.buffer)
  const width = end - start + 1
  const mask = (width === 32 ? 0xffffffff : ((1 << width) - 1) << start) >>> 0
  view.setUint32(4, ((view.getUint32(4, true) & ~mask) | ((value << start) & mask)) >>> 0, true)
  record.payload = payload
}

const base = open(input)
const before = props(base.target)
patch(base.target)
console.log(`'${ctrlId}' 속성 bit ${start}-${end} = ${value}: 0x${before.toString(16).padStart(8, '0')} → 0x${props(base.target).toString(16).padStart(8, '0')}`)

base.entry.content = maybeDeflate(serializeRecords(base.records), base.compressed) as any
base.entry.size = (base.entry.content as Uint8Array).length
writeFileSync(output, CFB.write(base.container, { type: 'buffer' }) as Uint8Array)

const expected = open(input)
patch(expected.target)
const written = open(output)
const recordsOk = isDeepStrictEqual(
  written.records.map((r) => [r.tagId, r.level, [...r.payload]]),
  expected.records.map((r) => [r.tagId, r.level, [...r.payload]]),
)
const streamsOk = expected.container.FullPaths.every((path, i) => {
  const entry = expected.container.FileIndex[i]!
  if (entry.type !== 2 || path.endsWith('/Section0')) return true
  const other = CFB.find(written.container, path)
  return other !== null && Buffer.compare(Buffer.from(entry.content as Uint8Array), Buffer.from(other.content as Uint8Array)) === 0
})
console.log(`check: Section0 레코드 ${recordsOk ? '일치' : '불일치'}, 다른 스트림 ${streamsOk ? '일치' : '불일치'}`)
if (!recordsOk || !streamsOk) process.exit(1)
