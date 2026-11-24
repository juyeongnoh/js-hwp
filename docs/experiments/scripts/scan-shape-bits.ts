// 저장소 HWP 파일의 모든 SHAPE_COMPONENT(표 83)를 원시 레코드에서 읽어 개체 요소 속성의 비트 분포를 보이고,
// 타원 속성·start2/end2와 다각형 끝 4바이트, 회전 개체의 회전 중심 등을 모은다. 코덱을 거치지 않는다.
// 사용: npx tsx docs/experiments/scripts/scan-shape-bits.ts [자세히: bit 번호]
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import CFB from 'cfb'
import { parseRecords } from '../../../packages/hwp/src/record.ts'
import { maybeInflate } from '../../../packages/hwp/src/compress.ts'
import { SectionTag } from '../../../packages/hwp/src/tags.ts'

const detail = process.argv[2] === undefined ? undefined : Number(process.argv[2])
const files = ['docs/experiments', 'fixtures', 'scratch'].flatMap((d) =>
  readdirSync(d, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.hwp')).map((f) => join(d, f)),
)
const id = (p: Uint8Array) => String.fromCharCode(p[3]!, p[2]!, p[1]!, p[0]!)
const bitCount: Record<string, Record<number, [number, number]>> = {}
const ellipses: string[] = []
const polygons: string[] = []
for (const file of files) {
  let c
  try { c = CFB.read(readFileSync(file), { type: 'buffer' }) } catch { continue }
  const fh = CFB.find(c, 'FileHeader')?.content as Uint8Array | undefined
  if (!fh) continue
  const ver = `${fh[35]}.${fh[34]}.${fh[33]}.${fh[32]}`
  const compressed = (fh[36]! & 1) === 1
  for (const e of c.FileIndex) {
    if (!/^Section\d+$/.test(e.name) || !e.content) continue
    let recs
    try { recs = parseRecords(maybeInflate(new Uint8Array(e.content as Uint8Array), compressed)) } catch { continue }
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i]!
      if (r.tagId !== SectionTag.ShapeComponent) continue
      const v = new DataView(r.payload.buffer, r.payload.byteOffset, r.payload.byteLength)
      const outer = id(r.payload)
      const inner = id(r.payload.subarray(4))
      const key = outer === inner ? outer : `${outer}(${inner})`
      if (r.payload.length < 40) continue
      const props = v.getUint32(36, true)
      const t = (bitCount[key] ??= {})
      for (let b = 0; b < 32; b++) { const x = (t[b] ??= [0, 0]); x[(props >>> b) & 1]++ }
      if (detail !== undefined && ((props >>> detail) & 1) === 0) console.log(`bit ${detail} off: ${key} ${file} v${ver} props=0x${props.toString(16)}`)
      // 이 SHAPE_COMPONENT 아래의 도형별 레코드
      for (let j = i + 1; j < recs.length && recs[j]!.level > r.level; j++) {
        const s = recs[j]!
        const sv = new DataView(s.payload.buffer, s.payload.byteOffset, s.payload.byteLength)
        if (s.tagId === SectionTag.ShapeComponentEllipse && s.payload.length >= 60) {
          const n = Array.from({ length: 14 }, (_, k) => sv.getInt32(4 + k * 4, true))
          ellipses.push(`${file} v${ver} props=0x${sv.getUint32(0, true).toString(16)} c=${n.slice(0, 2)} a1=${n.slice(2, 4)} a2=${n.slice(4, 6)} s1=${n.slice(6, 8)} e1=${n.slice(8, 10)} s2=${n.slice(10, 12)} e2=${n.slice(12, 14)}`)
        }
        if (s.tagId === SectionTag.ShapeComponentPolygon) {
          const cnt = sv.getUint32(0, true)
          const tail = [...s.payload.subarray(4 + cnt * 8)]
          const first = [sv.getInt32(4, true), sv.getInt32(8, true)]
          const last = [sv.getInt32(4 + (cnt - 1) * 8, true), sv.getInt32(8 + (cnt - 1) * 8, true)]
          polygons.push(`${file} v${ver} n=${cnt} closed=${first + '' === last + ''} tail=${tail}`)
        }
      }
    }
  }
}
if (detail === undefined) {
  for (const [k, t] of Object.entries(bitCount)) {
    const on = Object.entries(t).filter(([, [, one]]) => one > 0).map(([b, [z, o]]) => `${b}:${o}/${z + o}`)
    console.log(k, on.join(' '))
  }
  console.log('\n== ellipse'); ellipses.forEach((l) => console.log(l))
  console.log('\n== polygon'); polygons.forEach((l) => console.log(l))
}
