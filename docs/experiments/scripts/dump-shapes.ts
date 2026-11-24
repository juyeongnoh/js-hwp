// 파일의 그리기 개체(선·사각형·타원·호·다각형·곡선) 모델 값을 한 줄씩 보인다.
// 사용: npx tsx docs/experiments/scripts/dump-shapes.ts <파일>
import { readFileSync } from 'node:fs'
import { parseHwp } from '../../../packages/hwp/src/index.ts'
import { walkControls } from '../../../packages/core/src/index.ts'
const doc = parseHwp(new Uint8Array(readFileSync(process.argv[2]!)))
for (const c of walkControls(doc)) {
  if (!['line', 'rectangle', 'ellipse', 'arc', 'polygon', 'curve'].includes(c.type)) continue
  const { placement, outline, fill, shadow, textBox, childRecords, ...rest } = c as any
  const u8 = (_: string, v: unknown) => (v instanceof Uint8Array ? `U8[${[...v]}]` : v)
  console.log(JSON.stringify(rest, u8), textBox ? `textBox trailing ${u8('', textBox.textBoxTrailing)}` : '')
}
