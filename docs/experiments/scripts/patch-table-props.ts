// 첫 구역(Section0)에서 n번째(0부터) TABLE 레코드의 속성(표 76, 오프셋 0 UINT32)을 바꿔 새 파일로 저장한다.
// 코덱을 거치지 않고 원시 레코드만 고친다. 다시 읽어 그 레코드 말고는 Section0 레코드와 다른 스트림이
// 기반과 같은지 확인한다.
// 사용: npx tsx docs/experiments/scripts/patch-table-props.ts <기반> <출력> <TABLE 순번> <UINT32 값(0x... 가능)>
import { readFileSync, writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import CFB from 'cfb'
import { parseRecords, serializeRecords, type HwpRecord } from '../../../packages/hwp/src/record.ts'
import { maybeInflate, maybeDeflate } from '../../../packages/hwp/src/compress.ts'
import { SectionTag } from '../../../packages/hwp/src/tags.ts'

const [input, output, ...nums] = process.argv.slice(2) as [string, string, string, string, string]
const [index, value] = nums.map(Number) as [number, number]
const STREAM = '/BodyText/Section0'

function open(path: string) {
  const container = CFB.read(readFileSync(path), { type: 'buffer' })
  const compressed = ((CFB.find(container, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
  const entry = CFB.find(container, STREAM)!
  const records = parseRecords(maybeInflate(new Uint8Array(entry.content as Uint8Array), compressed))
  const target = records.filter((r) => r.tagId === SectionTag.Table)[index]!
  return { container, compressed, entry, records, target }
}

function patch(record: HwpRecord) {
  const payload = record.payload.slice()
  new DataView(payload.buffer).setUint32(0, value, true)
  record.payload = payload
}

const hex = (r: HwpRecord) => Buffer.from(r.payload.subarray(0, 4)).toString('hex')
const base = open(input)
const before = hex(base.target)
patch(base.target)
console.log(`TABLE[${index}] 속성 = 0x${value.toString(16)}: ${before} → ${hex(base.target)}`)

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
