// 첫 구역에서 개체(`tbl `, `gso `)마다 캡션 LIST_HEADER의 리스트 속성(오프셋 4 UINT32)과 켜진 비트,
// 캡션 속성(오프셋 8), 길이를 출력한다. 캡션은 CTRL_HEADER의 자식 중 TABLE·SHAPE_COMPONENT보다 앞의
// LIST_HEADER다(정정 81, 84). .hwpx를 주면 `hp:caption`과 그 안 `hp:subList`의 속성을 출력한다.
// 사용: npx vite-node docs/experiments/scripts/dump-caption-list-props.ts <파일.hwp|파일.hwpx>...
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import CFB from 'cfb'
import { strFromU8, unzipSync } from 'fflate'
import { buildRecordTree, parseRecords, type RecordNode } from '../../../packages/hwp/src/record.ts'
import { maybeInflate } from '../../../packages/hwp/src/compress.ts'
import { SectionTag } from '../../../packages/hwp/src/tags.ts'

const ctrlIdOf = (p: Uint8Array): string => String.fromCharCode(p[3]!, p[2]!, p[1]!, p[0]!)
const hex = (v: number): string => `0x${v.toString(16).padStart(8, '0')}`
const bitsOf = (v: number): number[] => [...Array(32).keys()].filter((b) => (v >>> b) & 1)

function dumpHwp(path: string): void {
  const container = CFB.read(readFileSync(path), { type: 'buffer' })
  const compressed = ((CFB.find(container, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
  const data = maybeInflate(new Uint8Array(CFB.find(container, '/BodyText/Section0')!.content as Uint8Array), compressed)
  const walk = (node: RecordNode): void => {
    const p = node.payload
    if (node.tagId === SectionTag.CtrlHeader && ['tbl ', 'gso '].includes(ctrlIdOf(p))) {
      const objectProps = new DataView(p.buffer, p.byteOffset, p.length).getUint32(4, true)
      for (const child of node.children) {
        if (child.tagId === SectionTag.Table || child.tagId === SectionTag.ShapeComponent) break
        if (child.tagId !== SectionTag.ListHeader) continue
        const v = new DataView(child.payload.buffer, child.payload.byteOffset, child.payload.length)
        const list = v.getUint32(4, true)
        const caption = v.getUint32(8, true)
        console.log(
          `${ctrlIdOf(p)} bit29=${(objectProps >>> 29) & 1} list=${hex(list)} bits=[${bitsOf(list)}] caption=${hex(caption)} (${child.payload.length}B)`,
        )
        break
      }
    }
    node.children.forEach(walk)
  }
  buildRecordTree(parseRecords(data)).forEach(walk)
}

function dumpHwpx(path: string): void {
  const files = unzipSync(new Uint8Array(readFileSync(path)))
  const xml = strFromU8(files['Contents/section0.xml']!)
  for (const m of xml.matchAll(/<hp:caption\b([^>]*)>\s*<hp:subList\b([^>]*)>/g))
    console.log(`caption${m[1]!.replace(/\s+/g, ' ')} | subList${m[2]!.replace(/\s+/g, ' ')}`)
}

for (const path of process.argv.slice(2)) {
  console.log(`# ${basename(path)}`)
  if (path.endsWith('.hwpx')) dumpHwpx(path)
  else dumpHwp(path)
}
