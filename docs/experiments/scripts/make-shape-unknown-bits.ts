// 뜻을 모르는 그리기 개체 값을 바꾼 파일을 만든다. 한글로 열어 그림이 달라지는지, 다시 저장하면 한글이 값을 바꾸는지 본다.
// 사용: npx tsx docs/experiments/scripts/make-shape-unknown-bits.ts
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import CFB from 'cfb'
import { parseHwp, serializeHwp } from '../../../packages/hwp/src/index.ts'
import { walkControls, type HwpDocument } from '../../../packages/core/src/index.ts'
import { parseRecords, serializeRecords } from '../../../packages/hwp/src/record.ts'
import { maybeInflate, maybeDeflate } from '../../../packages/hwp/src/compress.ts'
import { SectionTag } from '../../../packages/hwp/src/tags.ts'

const dir = 'docs/experiments'
const out = `${dir}/shape-unknown-bits`
const shapes = (doc: HwpDocument) => [...walkControls(doc)].filter((c) => 'instanceId' in c) as any[]

function make(src: string, name: string, edit: (s: any[]) => void) {
  const doc = parseHwp(new Uint8Array(readFileSync(`${dir}/${src}`)))
  const s = shapes(doc)
  edit(s)
  const bytes = serializeHwp(doc)
  writeFileSync(`${out}/${name}`, bytes)
  // 0인 unknownBits는 읽을 때 빠진다.
  const norm = (x: any[]) => JSON.parse(JSON.stringify(x, (k, v) => (k.endsWith('nknownBits') && v === 0 ? undefined : v)))
  assert.deepEqual(norm(shapes(parseHwp(bytes))), norm(s))
  console.log(`${name}: ok`)
}

// 개체 요소 속성(SHAPE_COMPONENT 오프셋 36)의 비트 하나를 원시 레코드에서 바꾼다. 그림은 아직 모델로 읽지 않는다.
function patchPicture(src: string, name: string, bit: number, on: boolean) {
  const c = CFB.read(readFileSync(`${dir}/${src}`), { type: 'buffer' })
  const compressed = ((CFB.find(c, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
  const e = CFB.find(c, '/BodyText/Section0')!
  const recs = parseRecords(maybeInflate(new Uint8Array(e.content as Uint8Array), compressed))
  const pics = recs.filter((r) => r.tagId === SectionTag.ShapeComponent && r.payload[0] === 0x63 && r.payload[1] === 0x69 && r.payload[3] === 0x24) // 'cip$' = '$pic'
  assert.equal(pics.length, 1)
  const p = pics[0]!.payload.slice()
  const v = new DataView(p.buffer)
  const before = v.getUint32(36, true)
  v.setUint32(36, on ? (before | (1 << bit)) >>> 0 : (before & ~(1 << bit)) >>> 0, true)
  pics[0]!.payload = p
  e.content = maybeDeflate(serializeRecords(recs), compressed) as any
  e.size = (e.content as Uint8Array).length
  writeFileSync(`${out}/${name}`, CFB.write(c, { type: 'buffer' }) as Uint8Array)
  console.log(`${name}: $pic 0x${before.toString(16)} → 0x${v.getUint32(36, true).toString(16)}`)
}

const off = (s: any, bit: number) => { s.unknownBits = (s.unknownBits & ~(1 << bit)) >>> 0 }
const on = (s: any, bit: number) => { s.unknownBits = (s.unknownBits | (1 << bit)) >>> 0 }

// 사각형 넷(그대로, 상하 대칭, 90°, 상하 대칭 + 30°): 첫째는 그대로, 둘째 bit 19 끔, 셋째 bit 26 켬, 넷째 bit 29 켬.
make('shape-rectangle/rotate-flip.hwp', 'rect-bits.hwp', (s) => {
  off(s[1], 19); on(s[2], 26); on(s[3], 29)
})

// 그림 하나: bit 19, 26, 29를 하나씩 끈다.
for (const bit of [19, 26, 29]) patchPicture('object-overlap-lock/picture-page-nooverlap.hwp', `pic-bit${bit}-off.hwp`, bit, false)

// 호로 바꾼 타원 셋(start1 오른쪽, 아래, 왼쪽. 모두 bit 16 켜짐).
// 첫째: start2를 아래 끝으로(bit 0 끔). 둘째: start2를 왼쪽 끝으로 하고 bit 0 켬. 셋째: bit 16만 끔.
make('shape-ellipse-arc-polygon-curve/ellipse-edit-angles.hwp', 'ellipse-interval.hwp', (s) => {
  assert.deepEqual(s.map((x) => x.type), ['ellipse', 'ellipse', 'ellipse'])
  s[0].start2 = { x: 12368, y: 14842 }
  s[1].start2 = { x: 0, y: 7421 }
  s[1].ellipseUnknownBits |= 1
  s[2].ellipseUnknownBits &= ~(1 << 16)
})

// 다각형 P1·P2(열림), P3(첫 점으로 닫음, 끝 1)와 곡선 C1·C2에 색 채우기를 넣고, P1과 C1의 끝 4바이트를 1로.
const fill = { color: { background: { r: 255, g: 200, b: 200, unknown: 0 }, pattern: { style: -1, color: { r: 0, g: 0, b: 0, unknown: 0 } }, transparency: 0 } }
make('shape-ellipse-arc-polygon-curve/polygon-curve-drawn.hwp', 'polygon-tail.hwp', (s) => {
  assert.deepEqual(s.map((x) => x.type), ['polygon', 'polygon', 'polygon', 'curve', 'curve'])
  for (const x of s) x.fill = structuredClone(fill)
  s[0].polygonTrailing = new Uint8Array([1, 0, 0, 0])
  s[3].curveTrailing = new Uint8Array([1, 0, 0, 0])
})

// 그러데이션 채우기 사각형: 그대로 하나와 bit 19를 끈 하나. 한글에서 둘 다 회전해 채우기가 같이 도는지 본다.
make('shape-fill/gradient.hwp', 'gradient-bit19-on.hwp', () => {})
make('shape-fill/gradient.hwp', 'gradient-bit19-off.hwp', (s) => { off(s[0], 19) })
