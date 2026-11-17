// 구역 정의(`secd`) CTRL_HEADER의 속성(표 130)과 26B 뒤 영역(CTRL_HEADER 페이로드 오프셋 30부터)을 출력한다.
// 문서 정보의 메모 모양(MEMO_SHAPE) 수와 각 레코드의 페이로드도 함께 출력한다.
// 사용: npx tsx docs/experiments/scripts/dump-section-def.ts <파일…>  (인자 `-`이면 표준 입력에서 한 줄에 하나씩 읽는다)
import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { parseRecords } from '../../../packages/hwp/src/record.ts'
import { maybeInflate } from '../../../packages/hwp/src/compress.ts'
import { DocInfoTag, SectionTag } from '../../../packages/hwp/src/tags.ts'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex').replace(/(..)(?!$)/g, '$1 ')
const paths = process.argv[2] === '-' ? readFileSync(0, 'utf8').split(/\r?\n/).filter(Boolean) : process.argv.slice(2)

for (const path of paths) {
  try {
    const container = CFB.read(readFileSync(path), { type: 'buffer' })
    const header = CFB.find(container, 'FileHeader')!.content as Uint8Array
    const version = `${header[35]}.${header[34]}.${header[33]}.${header[32]}`
    const compressed = (header[36]! & 1) === 1
    const read = (content: unknown) => parseRecords(maybeInflate(new Uint8Array(content as Uint8Array), compressed))

    const memoShapes = read(CFB.find(container, 'DocInfo')!.content).filter((r) => r.tagId === DocInfoTag.MemoShape)
    console.log(`${path} (${version}) 메모 모양 ${memoShapes.length}개`)
    memoShapes.forEach((r, i) => console.log(`  memo[${i}] ${hex(r.payload)}`))

    for (const entry of container.FileIndex) {
      if (!/^Section\d+$/.test(entry.name)) continue
      for (const r of read(entry.content)) {
        if (r.tagId !== SectionTag.CtrlHeader || String.fromCharCode(...r.payload.subarray(0, 4)) !== 'dces') continue
        const properties = new DataView(r.payload.buffer, r.payload.byteOffset).getUint32(4, true)
        console.log(`  ${entry.name} 속성 0x${properties.toString(16).padStart(8, '0')} [30~] ${hex(r.payload.subarray(30))}`)
      }
    }
  } catch (err) {
    console.log(`${path} 오류: ${err}`)
  }
}
