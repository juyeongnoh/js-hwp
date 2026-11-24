// 한글이 저장한 그리기 개체 표본을 모델로 읽고 값을 고쳐 serializeHwp로 쓴다. 한글이 받아들이는지 보려는 파일이다.
// 끝 바이트(lineTrailing 등)를 지워 코덱 기본값으로 쓰게 하고, 점·호 종류·구간 종류를 고치고, 글상자가 없던
// 다각형에 글상자를 붙인다(textBoxTrailing 없이). 다시 읽어 고친 값이 그대로인지 확인한다.
// 사용: npx tsx docs/experiments/scripts/make-shape-model-edits.ts
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseHwp, serializeHwp } from '../../../packages/hwp/src/index.ts'
import { walkControls, type HwpDocument } from '../../../packages/core/src/index.ts'

const dir = 'docs/experiments'
const shapes = (doc: HwpDocument) => [...walkControls(doc)].filter((c) => 'instanceId' in c) as any[]

function make(src: string, out: string, edit: (s: any[]) => void) {
  const doc = parseHwp(new Uint8Array(readFileSync(`${dir}/${src}`)))
  const s = shapes(doc)
  for (const c of s) for (const k of ['lineTrailing', 'polygonTrailing', 'curveTrailing']) delete c[k]
  edit(s)
  const bytes = serializeHwp(doc)
  writeFileSync(`${dir}/shape-model-edits/${out}`, bytes)
  const strip = (x: any[]) => JSON.parse(JSON.stringify(x, (k, v) => (k.endsWith('Trailing') ? undefined : v)))
  assert.deepEqual(strip(shapes(parseHwp(bytes))), strip(s))
  console.log(`${out}: ${s.length} shapes ok`)
}

// 선 1: 왼쪽 위 → 오른쪽 아래 대각선을 거꾸로(오른쪽 아래에서 시작).
make('shape-line/directions.hwp', 'line.hwp', (s) => {
  ;[s[0].start, s[0].end] = [s[0].end, s[0].start]
})

// 호: 활 모양(2). 열린 다각형: 셋째 점을 옮김. 곡선: 가운데 구간을 직선(0)으로.
make('shape-ellipse-arc-polygon-curve/shapes.hwp', 'arc-polygon-curve.hwp', (s) => {
  s[1].arcKind = 2
  s[2].points[2] = { x: 8000, y: 12868 }
  s[4].segmentTypes = [1, 0, 1]
})

// 글상자가 없던 셋째 개체(다각형)에 첫 개체의 글상자를 붙인다. 글상자가 있으면 한글은 bit 24를 켠다(정정 101).
make('shape-ellipse-arc-polygon-curve/polygon-curve-textbox-caption-rotate.hwp', 'textbox-added.hwp', (s) => {
  assert.ok(s[0].textBox && !s[2].textBox)
  s[2].textBox = structuredClone(s[0].textBox)
  delete s[2].textBox.textBoxTrailing
  s[2].unknownBits |= 1 << 24
})
