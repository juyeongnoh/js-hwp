// 그림 개체(`$pic`)를 모델로 읽어 출력한다. 배치(placement)는 따로 한 줄로 보인다.
// 사용: npx tsx docs/experiments/scripts/dump-pictures.ts <파일>...
import { readFileSync } from 'node:fs'
import { parseHwp } from '../../../packages/hwp/src/index.ts'
import { walkControls } from '../../../packages/core/src/index.ts'

const hex = (_: string, v: unknown) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v)
for (const file of process.argv.slice(2)) {
  for (const c of walkControls(parseHwp(new Uint8Array(readFileSync(file)))) as Iterable<any>) {
    if (c.type !== 'picture') continue
    const { placement, ...picture } = c
    console.log(file, JSON.stringify(picture, hex))
    console.log('  placement', JSON.stringify({ ...placement, caption: placement.caption ? '…' : undefined }, hex))
  }
}
