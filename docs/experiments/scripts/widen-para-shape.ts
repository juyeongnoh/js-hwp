// 46B 문단 모양 하나를 58B로 늘려 새 파일로 저장한다. 늘린 12바이트는 속성 3, 새 줄 간격, 문단 수준이다.
// 앞 46바이트는 그대로 두고, 문단 수준은 속성 1 bit 25~27에서 가져온다. 코덱을 거치지 않고 원시 레코드만 고친다.
// 다시 읽어 그 레코드 말고는 DocInfo 레코드와 다른 스트림이 기반과 같은지 확인한다.
// 사용: npx tsx docs/experiments/scripts/widen-para-shape.ts <기반> <출력> <문단 모양 인덱스> [<종류> <값>]
//   종류·값을 빼면 레코드를 고치지 않고 다시 쓰기만 한다(대조 파일).
import { readFileSync, writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import CFB from 'cfb'
import { parseRecords, serializeRecords, maybeInflate, maybeDeflate, DocInfoTag, type HwpRecord } from '../../../packages/hwp/src/index.ts'

const [input, output, nIdx, kind, value] = process.argv.slice(2)

function open(path: string) {
  const container = CFB.read(readFileSync(path), { type: 'buffer' })
  const compressed = ((CFB.find(container, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
  const entry = CFB.find(container, 'DocInfo')!
  const records = parseRecords(maybeInflate(new Uint8Array(entry.content as Uint8Array), compressed))
  const target = records.filter((r) => r.tagId === DocInfoTag.ParaShape)[Number(nIdx)]!
  return { container, compressed, entry, records, target }
}

function widen(record: HwpRecord) {
  if (kind === undefined) return
  if (record.payload.length !== 46) throw new Error(`46B가 아니다: ${record.payload.length}B`)
  const out = new Uint8Array(58)
  out.set(record.payload)
  const view = new DataView(out.buffer)
  view.setUint32(46, Number(kind), true)
  view.setUint32(50, Number(value), true)
  view.setUint32(54, (view.getUint32(0, true) >>> 25) & 7, true)
  record.payload = out
}

const base = open(input)
widen(base.target)
console.log(`문단 모양 ${nIdx}: ${base.target.payload.length}B, 오프셋 46~57 ${Buffer.from(base.target.payload.subarray(46)).toString('hex') || '없음'}`)

base.entry.content = maybeDeflate(serializeRecords(base.records), base.compressed) as any
base.entry.size = (base.entry.content as Uint8Array).length
writeFileSync(output, CFB.write(base.container, { type: 'buffer' }) as Uint8Array)

const expected = open(input)
widen(expected.target)
const written = open(output)
const recordsOk = isDeepStrictEqual(
  written.records.map((r) => [r.tagId, r.level, [...r.payload]]),
  expected.records.map((r) => [r.tagId, r.level, [...r.payload]]),
)
const streamsOk = expected.container.FullPaths.every((path, i) => {
  const entry = expected.container.FileIndex[i]!
  if (entry.type !== 2 || path.endsWith('/DocInfo')) return true
  const other = CFB.find(written.container, path)
  return other !== null && Buffer.compare(Buffer.from(entry.content as Uint8Array), Buffer.from(other.content as Uint8Array)) === 0
})
console.log(`check: DocInfo 레코드 ${recordsOk ? '일치' : '불일치'}, 다른 스트림 ${streamsOk ? '일치' : '불일치'}`)
if (!recordsOk || !streamsOk) process.exit(1)
