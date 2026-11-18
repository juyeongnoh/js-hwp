// 문단마다 PARA_TEXT와 PARA_RANGE_TAG(표 63)를 출력한다. 코덱을 거치지 않고 원시 레코드만 읽는다.
// 문단 텍스트는 글자 그대로, 제어 문자는 `{위치:코드 ctrlId}`로 보인다. 영역 태그는 시작·끝 글자 위치,
// 종류(태그 상위 8비트), 데이터(하위 24비트)로 나눠 보인다. CTRL_HEADER는 ctrlId와 페이로드 길이를 보인다.
// 사용: npx tsx docs/experiments/scripts/dump-range-tags.ts <파일>...
import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { buildRecordTree, parseRecords, type RecordNode } from '../../../packages/hwp/src/record.ts'
import { maybeInflate } from '../../../packages/hwp/src/compress.ts'
import { SectionTag } from '../../../packages/hwp/src/tags.ts'

/** 표 6. 8칸을 차지하는 제어 문자(inline, extended). */
const WIDE = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])

/** 디스크의 UINT32 ctrlId를 네 글자로 읽는다. 바이트 역순이다. */
const ctrlId = (lo: number, hi: number): string =>
  [hi >>> 8, hi & 0xff, lo >>> 8, lo & 0xff].map((c) => (c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.')).join('')

function text(payload: Uint8Array): string {
  const codes: number[] = []
  for (let i = 0; i + 1 < payload.length; i += 2) codes.push(payload[i]! | (payload[i + 1]! << 8))
  let out = ''
  for (let i = 0; i < codes.length; ) {
    const c = codes[i]!
    if (c >= 32) { out += String.fromCharCode(c); i++; continue }
    if (!WIDE.has(c)) { out += `{${i}:${c.toString(16)}}`; i++; continue }
    out += `{${i}:${c.toString(16)} ${ctrlId(codes[i + 1]!, codes[i + 2]!)}}`
    i += 8
  }
  return out
}

for (const path of process.argv.slice(2)) {
  const container = CFB.read(readFileSync(path), { type: 'buffer' })
  const compressed = ((CFB.find(container, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
  console.log(`== ${path}`)
  let index = 0
  const walk = (node: RecordNode, depth: number): void => {
    if (node.tagId === SectionTag.ParaHeader) {
      const pad = '  '.repeat(depth)
      const record = node.children.find((child) => child.tagId === SectionTag.ParaText)
      console.log(`${pad}문단 ${index++} ${record ? text(record.payload) : '(텍스트 없음)'}`)
      for (const child of node.children) {
        if (child.tagId === SectionTag.CtrlHeader) {
          const p = child.payload
          console.log(`${pad}  CTRL_HEADER ${ctrlId(p[0]! | (p[1]! << 8), p[2]! | (p[3]! << 8))} ${p.length}B`)
        }
        if (child.tagId !== SectionTag.ParaRangeTag) continue
        const view = new DataView(child.payload.buffer, child.payload.byteOffset, child.payload.byteLength)
        for (let i = 0; i + 12 <= view.byteLength; i += 12) {
          const tag = view.getUint32(i + 8, true)
          const data = (tag & 0xffffff).toString(16).padStart(6, '0')
          console.log(`${pad}  RANGE_TAG start=${view.getUint32(i, true)} end=${view.getUint32(i + 4, true)} kind=${tag >>> 24} data=0x${data}`)
        }
        if (view.byteLength % 12) console.log(`${pad}  RANGE_TAG 남는 바이트 ${view.byteLength % 12}B`)
      }
    }
    node.children.forEach((child) => walk(child, node.tagId === SectionTag.ParaHeader ? depth + 1 : depth))
  }
  for (const stream of container.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p))) {
    const data = new Uint8Array(CFB.find(container, stream.replace(/^[^/]*/, ''))!.content as Uint8Array)
    buildRecordTree(parseRecords(maybeInflate(data, compressed))).forEach((node) => walk(node, 0))
  }
}
