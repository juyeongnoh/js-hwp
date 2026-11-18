// 첫 구역에서 지정한 ctrlId(기본 `gso `)의 CTRL_HEADER부터 자식 레코드 트리를 출력한다.
// 레코드마다 태그, 길이, 앞 40바이트를 16진수로 보인다.
// 사용: npx tsx docs/experiments/scripts/dump-record-tree.ts <파일> [ctrlId] [깊이]
import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { buildRecordTree, parseRecords, type RecordNode } from '../../../packages/hwp/src/record.ts'
import { maybeInflate } from '../../../packages/hwp/src/compress.ts'
import { SectionTag } from '../../../packages/hwp/src/tags.ts'

const [path, ctrlId = 'gso ', maxDepth = '4'] = process.argv.slice(2) as [string, string?, string?]
const container = CFB.read(readFileSync(path), { type: 'buffer' })
const compressed = ((CFB.find(container, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
const data = maybeInflate(new Uint8Array(CFB.find(container, '/BodyText/Section0')!.content as Uint8Array), compressed)
const tagName = (tag: number): string => (SectionTag as unknown as Record<number, string>)[tag] ?? String(tag)

function print(node: RecordNode, depth: number): void {
  if (depth > Number(maxDepth)) return
  const head = Buffer.from(node.payload.subarray(0, 40)).toString('hex')
  console.log(`${'  '.repeat(depth)}${tagName(node.tagId)} ${node.payload.length}B ${head}`)
  node.children.forEach((child) => print(child, depth + 1))
}

function find(node: RecordNode): void {
  const p = node.payload
  if (node.tagId === SectionTag.CtrlHeader && String.fromCharCode(p[3]!, p[2]!, p[1]!, p[0]!) === ctrlId) {
    print(node, 0)
    return
  }
  node.children.forEach(find)
}

buildRecordTree(parseRecords(data)).forEach(find)
