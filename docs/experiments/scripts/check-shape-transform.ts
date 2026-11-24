// 저장소의 모든 그리기 개체(모델로 읽는 것)에서 SHAPE_COMPONENT 행렬 사이의 관계를 확인한다(±1 HWPUNIT).
//   M = translation × rotation × scale (scaleRotations가 여럿이면 차례로 곱함)
//   1. M × 처음 크기 사각형 (0, 0)–(처음 폭, 처음 높이)의 범위는 (0, 0)에서 시작하고, 크기가 개체 공통 속성 폭·높이와 같다
//      (폭·높이 기준이 고정값일 때).
//   2. 현재 폭 = scale[0] × 처음 폭, 현재 높이 = scale[4] × 처음 높이
//   3. 회전 중심 = M × (처음 폭 / 2, 처음 높이 / 2)
// 사용: npx tsx docs/experiments/scripts/check-shape-transform.ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseHwp } from '../../../packages/hwp/src/index.ts'
import { walkControls } from '../../../packages/core/src/index.ts'
type M = number[]
const mul = (a: M, b: M): M => [a[0]!*b[0]!+a[1]!*b[3]!, a[0]!*b[1]!+a[1]!*b[4]!, a[0]!*b[2]!+a[1]!*b[5]!+a[2]!, a[3]!*b[0]!+a[4]!*b[3]!, a[3]!*b[1]!+a[4]!*b[4]!, a[3]!*b[2]!+a[4]!*b[5]!+a[5]!]
const files = ['docs/experiments','fixtures','scratch'].flatMap(d => readdirSync(d,{recursive:true,encoding:'utf8'}).filter(f=>f.endsWith('.hwp')).map(f=>join(d,f)))
let n = 0, bad = 0
for (const f of files) { let doc; try { doc = parseHwp(new Uint8Array(readFileSync(f))) } catch { continue }
  for (const c of walkControls(doc) as any) { if (!c.scaleRotations) continue; n++
    let m = c.translation as M; for (const p of c.scaleRotations) m = mul(m, mul(p.rotation, p.scale))
    const pts = [[0,0],[c.initialWidth,0],[c.initialWidth,c.initialHeight],[0,c.initialHeight]].map(([x,y]) => [m[0]!*x!+m[1]!*y!+m[2]!, m[3]!*x!+m[4]!*y!+m[5]!])
    const xs = pts.map(p=>p[0]!), ys = pts.map(p=>p[1]!)
    const minx = Math.min(...xs), miny = Math.min(...ys), W = Math.max(...xs)-minx, H = Math.max(...ys)-miny
    const s = c.scaleRotations[0].scale
    const wOk = Math.abs(s[0]*c.initialWidth - c.width) <= 1 && Math.abs(s[4]*c.initialHeight - c.height) <= 1
    const ok = Math.abs(minx) <= 1 && Math.abs(miny) <= 1 && ((c.placement.widthCriterion ?? 4) !== 4 || Math.abs(W - c.placement.width) <= 1.5) && ((c.placement.heightCriterion ?? 2) !== 2 || Math.abs(H - c.placement.height) <= 1.5)
    const cen = [(m[0]!*c.initialWidth/2 + m[1]!*c.initialHeight/2 + m[2]!), (m[3]!*c.initialWidth/2 + m[4]!*c.initialHeight/2 + m[5]!)]
    const cOk = Math.abs(cen[0]!-c.rotationCenter.x) <= 1 && Math.abs(cen[1]!-c.rotationCenter.y) <= 1
    if (!ok || !wOk || !cOk) { bad++; console.log(f.split('/').slice(-2).join('/'), c.type, `min ${minx.toFixed(1)},${miny.toFixed(1)} bbox ${W.toFixed(1)}×${H.toFixed(1)} placement ${c.placement.width}×${c.placement.height} w ${c.width}/${(s[0]*c.initialWidth).toFixed(1)} h ${c.height}/${(s[4]*c.initialHeight).toFixed(1)} center ${c.rotationCenter.x},${c.rotationCenter.y} vs ${cen.map(x=>x.toFixed(1))}`) }
  } }
console.log(`${n} shapes, ${bad} mismatches`)
