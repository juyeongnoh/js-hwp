// 첫 구역의 개체(`tbl `, `gso `)마다 캡션 LIST_HEADER의 필드와 캡션 첫 문단 텍스트를 출력한다.
// 리스트 속성(오프셋 4), 캡션 속성(8), 폭(12), 간격(16, HWPUNIT16), 텍스트 최대 길이(18), 그 뒤 바이트.
// 사용: npx vite-node docs/experiments/scripts/dump-captions.ts <파일.hwp>...
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import CFB from 'cfb'
import { buildRecordTree, parseRecords, type RecordNode } from '../../../packages/hwp/src/record.ts'
import { maybeInflate } from '../../../packages/hwp/src/compress.ts'
import { SectionTag } from '../../../packages/hwp/src/tags.ts'

const ctrlIdOf = (p: Uint8Array): string => String.fromCharCode(p[3]!, p[2]!, p[1]!, p[0]!)
const hex = (v: number): string => `0x${v.toString(16).padStart(8, '0')}`
const view = (p: Uint8Array) => new DataView(p.buffer, p.byteOffset, p.length)

function textOf(node: RecordNode | undefined): string {
  const t = node?.children.find((c) => c.tagId === SectionTag.ParaText)
  if (!t) return ''
  let s = ''
  for (let i = 0; i + 1 < t.payload.length; i += 2) {
    const c = t.payload[i]! | (t.payload[i + 1]! << 8)
    if (c >= 32) s += String.fromCharCode(c)
  }
  return s
}

for (const path of process.argv.slice(2)) {
  console.log(`# ${basename(path)}`)
  const container = CFB.read(readFileSync(path), { type: 'buffer' })
  const compressed = ((CFB.find(container, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
  const data = maybeInflate(new Uint8Array(CFB.find(container, '/BodyText/Section0')!.content as Uint8Array), compressed)
  const walk = (node: RecordNode): void => {
    const p = node.payload
    if (node.tagId === SectionTag.CtrlHeader && ['tbl ', 'gso '].includes(ctrlIdOf(p))) {
      const kids = node.children
      const i = kids.findIndex((c) => c.tagId === SectionTag.ListHeader)
      const stop = kids.findIndex((c) => c.tagId === SectionTag.Table || c.tagId === SectionTag.ShapeComponent)
      if (i >= 0 && (stop < 0 || i < stop)) {
        const payload = kids[i]!.payload
        const v = view(payload)
        const tail = Array.from(payload.slice(22)).map((b) => b.toString(16).padStart(2, '0')).join(' ')
        console.log(
          `${ctrlIdOf(p)} list=${hex(v.getUint32(4, true))} caption=${hex(v.getUint32(8, true))} width=${v.getUint32(12, true)} gap=${v.getInt16(16, true)} maxWidth=${v.getUint32(18, true)} tail=[${tail}] (${payload.length}B) "${textOf(kids[i + 1])}"`,
        )
      }
    }
    node.children.forEach(walk)
  }
  buildRecordTree(parseRecords(data)).forEach(walk)
}
