import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NumberingKind, RelativeTo, TextWrap, type Control } from '@js-hwp/core'
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

const OBJECTS = new Set(['tbl ', 'gso ', 'eqed'])

/**
 * 개체 컨트롤(`tbl `, `gso `, `eqed`)의 CTRL_HEADER 페이로드를 나온 순서대로.
 * `gso ` 안(글상자 등)은 건너뛴다. 코덱이 `gso `를 unknown으로 보존하며 자식 레코드를
 * 버리기 때문이다(BACKLOG "unknown 컨트롤의 자식 레코드 손실").
 */
function objectHeaders(bytes: Uint8Array): string[] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  const out: string[] = []
  const walk = (n: RecordNode): void => {
    if (n.tagId === SectionTag.CtrlHeader) {
      const p = n.payload
      const id = String.fromCharCode(p[3]!, p[2]!, p[1]!, p[0]!)
      if (OBJECTS.has(id)) out.push(Buffer.from(p).toString('hex'))
      if (id === 'gso ') return
    }
    n.children.forEach(walk)
  }
  for (const p of c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p))) {
    const data = new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array)
    buildRecordTree(parseRecords(maybeInflate(data, compressed))).forEach(walk)
  }
  return out
}

describe('저장소 HWP 파일의 개체 CTRL_HEADER 왕복', () => {
  it.each(files.map((f) => [f.slice(root.length + 1), f]))('%s', (_, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    expect(objectHeaders(serializeHwp(parseHwp(bytes)))).toEqual(objectHeaders(bytes))
  })
})

/** 첫 구역 최상위 문단에서 처음 나오는 표. */
function firstTable(path: string): Extract<Control, { type: 'table' }> {
  const doc = parseHwp(new Uint8Array(readFileSync(join(root, path))))
  for (const paragraph of doc.sections[0]!.paragraphs) {
    for (const item of paragraph.runs.flatMap((r) => r.items)) {
      if (item.type === 'table') return item
    }
  }
  throw new Error(`표가 없다: ${path}`)
}

describe('개체 공통 속성 (experiments/object-common-props, 한글 2024)', () => {
  const dir = 'docs/experiments/object-common-props'

  it('바깥 여백을 왼쪽, 오른쪽, 위쪽, 아래쪽 순서로 읽는다', () => {
    // 대화상자 값: 왼쪽 1.5, 오른쪽 2.5, 위쪽 3.5, 아래쪽 4.5mm
    const { placement } = firstTable(`${dir}/table-wrap-square.hwp`)
    const mm = (v: number | undefined) => Math.round(((v ?? 0) * 25.4) / 7200 * 10) / 10
    expect([placement.marginLeft, placement.marginRight, placement.marginTop, placement.marginBottom].map(mm)).toEqual([
      1.5, 2.5, 3.5, 4.5,
    ])
  })

  it('속성 비트: 크기 고정, 번호 종류, 개체 보호, 본문과의 배치', () => {
    const { placement } = firstTable(`${dir}/table-wrap-square.hwp`)
    expect(placement).toMatchObject({
      fixedSize: true,
      numberingKind: NumberingKind.Figure,
      locked: true,
      textWrap: TextWrap.Square,
      vertRelTo: RelativeTo.Page,
      horzRelTo: RelativeTo.Page,
      unknownBits: 0,
    })
  })

  it('자리 차지와 글 뒤로를 구분한다', () => {
    expect(firstTable(`${dir}/table-topbottom-para.hwp`).placement.textWrap).toBe(TextWrap.TopAndBottom)
    expect(firstTable(`${dir}/table-behind-para.hwp`).placement.textWrap).toBe(TextWrap.BehindText)
  })

  it('쪽나눔 방지("개체와 조판 부호를 항상 같은 쪽에 놓기")와 설명문 뒤 2바이트', () => {
    const { placement } = firstTable(`${dir}/table-topbottom-para.hwp`)
    expect(placement.keepWithAnchor).toBe(true)
    expect(placement.description).toBe('')
    expect(placement.trailing).toEqual([0, 0])
    expect(firstTable(`${dir}/table-wrap-square.hwp`).placement.keepWithAnchor).toBe(false)
  })
})
