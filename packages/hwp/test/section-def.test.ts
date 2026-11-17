import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DocumentBuilder, TextDirection } from '@js-hwp/core'
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

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')

/** 구역 정의마다 `secd` 페이로드와 자식 레코드(태그:바이트) 목록. */
function sectionDefs(bytes: Uint8Array): string[][] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  const out: string[][] = []
  const walk = (n: RecordNode): void => {
    if (n.tagId === SectionTag.CtrlHeader && hex(n.payload.subarray(0, 4)) === '64636573') {
      out.push([hex(n.payload), ...n.children.map((child) => `${child.tagId}:${hex(child.payload)}`)])
    }
    n.children.forEach(walk)
  }
  for (const p of c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p))) {
    const data = new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array)
    buildRecordTree(parseRecords(maybeInflate(data, compressed))).forEach(walk)
  }
  return out
}

describe('저장소 HWP 파일의 구역 정의 왕복', () => {
  it.each(files.map((f) => [f.slice(root.length + 1), f]))('%s', (_, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    expect(sectionDefs(serializeHwp(parseHwp(bytes)))).toEqual(sectionDefs(bytes))
  })
})

describe('새 문서의 구역 정의', () => {
  const [secd] = sectionDefs(serializeHwp(new DocumentBuilder().paragraph('가').build()))
  const view = new DataView(new Uint8Array(Buffer.from(secd![0]!, 'hex')).buffer)

  it('한글 새 문서처럼 단 사이 간격 1134, 기본 탭 간격 8000(40pt), 끝 17바이트로 쓴다', () => {
    expect(view.getInt16(8, true)).toBe(1134)
    expect(view.getUint32(14, true)).toBe(8000)
    expect(view.byteLength).toBe(47)
  })

  it('각주·미주 모양을 한글 새 문서와 같은 28바이트로 쓴다', () => {
    expect(secd!.filter((r) => r.startsWith(`${SectionTag.FootnoteShape}:`))).toEqual([
      `${SectionTag.FootnoteShape}:000000000000000029000100ffffffff520337021b01010100000000`,
      `${SectionTag.FootnoteShape}:000000000000000029000100f82fe000520337020000010100000000`,
    ])
  })
})

describe('구역 정의 26B 뒤 영역의 필드 (정오표 64, 70)', () => {
  const read = (path: string) => parseHwp(new Uint8Array(readFileSync(join(root, path))))
  const props = (path: string, index = 0) => read(path).sections[index]!.properties!

  it('한글이 저장한 글자 방향과 머리말/꼬리말 세로쓰기를 읽는다', () => {
    const dir = 'docs/experiments/section-text-direction'
    expect(props(`${dir}/base-horizontal.hwp`).textDirection).toBeUndefined()
    expect(props(`${dir}/saved-vertical-lying.hwp`).textDirection).toBe(TextDirection.Vertical)
    expect(props(`${dir}/saved-vertical-standing.hwp`).textDirection).toBe(TextDirection.VerticalAll)
    expect(props(`${dir}/saved-vertical-lying-header.hwp`)).toMatchObject({
      textDirection: TextDirection.Vertical,
      verticalHeaderFooter: true,
    })
    // 한글이 쓰지 않는 값도 3비트 그대로 읽는다(E27).
    expect(props(`${dir}/byte36-08.hwp`).textDirection).toBe(4)
  })

  it('메모 모양 ID를 0부터 센 인덱스로 읽는다', () => {
    const dir = 'docs/experiments/section-memo-shape-id'
    expect(props(`${dir}/base-two-memo-shapes.hwp`, 0).memoShapeId).toBe(0)
    expect(props(`${dir}/base-two-memo-shapes.hwp`, 1).memoShapeId).toBe(1)
    expect(props(`${dir}/section0-byte34-00.hwp`, 0).memoShapeId).toBeUndefined()
    expect(props(`${dir}/section0-byte34-02-byte35-01.hwp`, 0).memoShapeId).toBe(0x0101)
  })

  it('필드를 바꾸면 trailing의 해당 비트만 바꿔 쓴다', () => {
    const doc = read('docs/experiments/section-text-direction/saved-vertical-lying-header.hwp')
    const before = doc.sections[0]!.properties!
    Object.assign(before, { textDirection: TextDirection.VerticalAll, verticalHeaderFooter: undefined, memoShapeId: 2 })
    const after = parseHwp(serializeHwp(doc)).sections[0]!.properties!
    expect(after).toMatchObject({ textDirection: TextDirection.VerticalAll, memoShapeId: 2 })
    expect(after.verticalHeaderFooter).toBeUndefined()
    expect(hex(after.trailing!)).toBe('0000000003000400000000000000000000')
  })

  it('새 문서는 필드가 없으면 0으로 쓰고, 지정하면 그 값을 쓴다', () => {
    const doc = new DocumentBuilder().paragraph('가').build()
    expect(parseHwp(serializeHwp(doc)).sections[0]!.properties).not.toHaveProperty('textDirection')
    doc.sections[0]!.properties = { textDirection: TextDirection.Vertical, verticalHeaderFooter: true }
    const [secd] = sectionDefs(serializeHwp(doc))
    expect(secd![0]!.slice(30 * 2)).toBe('0000000000001200000000000000000000')
  })
})
