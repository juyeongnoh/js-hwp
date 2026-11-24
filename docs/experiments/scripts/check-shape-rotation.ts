// 회전·대칭·크기 변경된 그리기 개체에서 회전 중심, group offset, translation, rotation matrix, 개체 공통 속성 폭·높이가
// 아래 식과 맞는지 본다(w, h = SHAPE_COMPONENT 현재 폭·높이, θ = 회전각, c = cos θ, s = sin θ).
//   cos, sin은 소수 여섯째 자리로 반올림. 중심 (cx, cy) = (⌊w/2⌋, ⌊h/2⌋)
//   rotation = R(θ, 중심 (cx, cy)) × flip. 대칭은 (−1, 0, 2cx, 0, 1, 0), (1, 0, 0, 0, −1, 2cy)
//   (gx, gy) = round(−min(R × 네 꼭짓점)), 대칭은 넣지 않는다. group offset, translation (1, 0, gx, 0, 1, gy)
//   회전 중심 = (cx + gx, cy + gy). 개체 공통 속성 폭·높이 = round(R × 네 꼭짓점의 범위)
// 사용: npx tsx docs/experiments/scripts/check-shape-rotation.ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseHwp } from '../../../packages/hwp/src/index.ts'
import { walkControls } from '../../../packages/core/src/index.ts'

type M = number[]
const mul = (a: M, b: M): M => [
  a[0]! * b[0]! + a[1]! * b[3]!, a[0]! * b[1]! + a[1]! * b[4]!, a[0]! * b[2]! + a[1]! * b[5]! + a[2]!,
  a[3]! * b[0]! + a[4]! * b[3]!, a[3]! * b[1]! + a[4]! * b[4]!, a[3]! * b[2]! + a[4]! * b[5]! + a[5]!,
]
const files = ['docs/experiments', 'fixtures', 'scratch'].flatMap((d) =>
  readdirSync(d, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.hwp')).map((f) => join(d, f)))
const fmt = (m: M) => m.map((x) => +x.toFixed(3)).join(', ')
for (const file of files) {
  let doc
  try { doc = parseHwp(new Uint8Array(readFileSync(file))) } catch { continue }
  for (const c of walkControls(doc) as Iterable<any>) {
    if (!('rotationCenter' in c) || !c.scaleRotations) continue
    const rot = c.scaleRotations[0].rotation as M
    const identity = rot.join() === '1,0,0,0,1,0'
    if (identity && !c.rotation && c.groupOffsetX === 0 && c.groupOffsetY === 0) {
      // 회전 없음: 중심만 본다
      const ok = c.rotationCenter.x === Math.floor(c.width / 2) && c.rotationCenter.y === Math.floor(c.height / 2)
      if (!ok) console.log(`center mismatch (no rotation) ${c.type} ${file}: ${c.rotationCenter.x},${c.rotationCenter.y} w=${c.width} h=${c.height}`)
      continue
    }
    const { width: w, height: h } = c
    const t = (c.rotation * Math.PI) / 180
    const r6 = (x: number) => Math.round(x * 1e6) / 1e6
    const co = r6(Math.cos(t)), si = r6(Math.sin(t))
    const cx = Math.floor(w / 2), cy = Math.floor(h / 2)
    const R: M = [co, -si, cx - co * cx + si * cy, si, co, cy - si * cx - co * cy]
    let pred = R
    if (c.flipHorizontal) pred = mul(pred, [-1, 0, 2 * cx, 0, 1, 0])
    if (c.flipVertical) pred = mul(pred, [1, 0, 0, 0, -1, 2 * cy])
    const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => [R[0]! * x! + R[1]! * y! + R[2]!, R[3]! * x! + R[4]! * y! + R[5]!])
    const xs = corners.map((p) => p[0]!), ys = corners.map((p) => p[1]!)
    const gx = Math.round(-Math.min(...xs)), gy = Math.round(-Math.min(...ys))
    const W = `${(Math.max(...xs) - Math.min(...xs)).toFixed(2)}`, H = `${(Math.max(...ys) - Math.min(...ys)).toFixed(2)}`
    const center = [cx + gx, cy + gy]
    console.log(`${c.type} ${file.split('/').slice(-2).join('/')} θ=${c.rotation} flip=${c.flipHorizontal ? 'H' : ''}${c.flipVertical ? 'V' : ''} w×h=${w}×${h} initial=${c.initialWidth}×${c.initialHeight}
  placement ${c.placement.width}×${c.placement.height} pred ${W}×${H}
  groupOffset ${c.groupOffsetX},${c.groupOffsetY} pred ${gx},${gy}  translation ${fmt(c.translation)}
  center ${c.rotationCenter.x},${c.rotationCenter.y} pred ${center}
  rotation ${fmt(rot)}
  pred     ${fmt(pred)}
  scale    ${fmt(c.scaleRotations[0].scale)}`)
  }
}
