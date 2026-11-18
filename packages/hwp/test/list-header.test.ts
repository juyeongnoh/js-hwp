import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DocumentBuilder, VerticalAlign, type Control } from '@js-hwp/core'
import CFB from 'cfb'
import { describe, expect, it } from 'vitest'
import { maybeInflate } from '../src/compress.js'
import { parseHwp, serializeHwp } from '../src/document.js'
import { buildRecordTree, parseRecords, type RecordNode } from '../src/record.js'
import { SectionTag } from '../src/tags.js'

const root = join(__dirname, '../../..')
const files = ['docs/experiments', 'fixtures', 'scratch'].flatMap((d) =>
  readdirSync(join(root, d), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.hwp'))
    .map((f) => join(root, d, f)),
)

/**
 * 모든 LIST_HEADER의 앞 8바이트(문단 수 UINT32, 속성 UINT32, 정정 83). `gso ` 안은 건너뛴다.
 * 코덱이 `gso `를 unknown으로 보존하며 자식 레코드를 버리기 때문이다(BACKLOG).
 */
function listHeads(bytes: Uint8Array): string[] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  const out: string[] = []
  const walk = (n: RecordNode): void => {
    if (n.tagId === SectionTag.ListHeader) out.push(Buffer.from(n.payload.subarray(0, 8)).toString('hex'))
    if (n.tagId === SectionTag.CtrlHeader && String.fromCharCode(n.payload[3]!, n.payload[2]!, n.payload[1]!, n.payload[0]!) === 'gso ') return
    n.children.forEach(walk)
  }
  for (const p of c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p))) {
    const data = new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array)
    buildRecordTree(parseRecords(maybeInflate(data, compressed))).forEach(walk)
  }
  return out
}

/** 문단 수를 일부러 틀리게 바꾼 실험 파일. 코덱은 실제 문단 수를 쓰므로 속성만 비교한다. */
const WRONG_COUNT = /list-header-para-count[\\/]cell1-/

describe('저장소 HWP 파일의 LIST_HEADER 앞 8바이트 왕복', () => {
  it.each(files.map((f) => [f.slice(root.length + 1), f]))('%s', (_, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    const pick = WRONG_COUNT.test(file) ? (h: string[]) => h.map((x) => x.slice(8)) : (h: string[]) => h
    expect(pick(listHeads(serializeHwp(parseHwp(bytes))))).toEqual(pick(listHeads(bytes)))
  })

  it('문단 수가 틀린 LIST_HEADER는 실제 문단 수로 다시 쓴다', () => {
    const bytes = new Uint8Array(readFileSync(join(root, 'docs/experiments/list-header-para-count/cell1-bytes2-ffff.hwp')))
    expect(listHeads(bytes)[0]).toBe('0100ffff20000000')
    expect(listHeads(serializeHwp(parseHwp(bytes)))[0]).toBe('0100000020000000')
  })
})

const firstTable = (path: string): Extract<Control, { type: 'table' }> => {
  const item = parseHwp(new Uint8Array(readFileSync(join(root, path)))).sections[0]!.paragraphs[0]!.runs[0]!.items[0]
  if (item?.type !== 'table') throw new Error(`표가 없다: ${path}`)
  return item
}

describe('LIST_HEADER 문단 수 (experiments/list-header-para-count, 한글 2024)', () => {
  it('문단 수를 INT32로 다룬다: 셀 문단 70,001개를 모두 읽는다', () => {
    const table = firstTable('docs/experiments/list-header-para-count/cell-70001-paras.hwp')
    expect(table.rows[0]!.cells[0]!.paragraphs).toHaveLength(70_001)
  })

  it('문단 수가 틀려도 레코드 구조로 문단을 나눈다 (한글처럼)', () => {
    const table = firstTable('docs/experiments/list-header-para-count/cell1-count-0.hwp')
    const text = table.rows.flatMap((r) => r.cells.map((c) => c.paragraphs.flatMap((p) => p.runs.flatMap((run) => run.items.map((i) => (i.type === 'text' ? i.value : '')))).join('')))
    expect(text).toEqual(['가', '나', '다', '라'])
  })
})

describe('셀 세로 정렬 (experiments/cell-vertical-align, 한글 2024)', () => {
  it('속성을 오프셋 4에서 읽는다: 위, 가운데, 아래, 기본(가운데)', () => {
    const cells = firstTable('docs/experiments/cell-vertical-align/top-center-bottom.hwp').rows[0]!.cells
    expect(cells.map((c) => c.verticalAlign)).toEqual([
      VerticalAlign.Top,
      VerticalAlign.Center,
      VerticalAlign.Bottom,
      VerticalAlign.Center,
    ])
  })

  it('빌더 셀의 정렬을 오프셋 4에 쓰고, 정하지 않으면 가운데로 쓴다', () => {
    const doc = new DocumentBuilder().table([['a', 'b']]).build()
    const table = doc.sections[0]!.paragraphs[0]!.runs[0]!.items[0] as Extract<Control, { type: 'table' }>
    table.rows[0]!.cells[0]!.verticalAlign = VerticalAlign.Bottom
    const heads = listHeads(serializeHwp(doc))
    // 문단 수 1(UINT32), 속성 0x40(아래) / 0x20(가운데)
    expect(heads).toEqual(['0100000040000000', '0100000020000000'])
  })
})
