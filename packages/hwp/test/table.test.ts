import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DocumentBuilder, type Control, type HwpDocument } from '@js-hwp/core'
import CFB from 'cfb'
import { describe, expect, it } from 'vitest'
import { maybeInflate } from '../src/compress.js'
import { parseHwp, serializeHwp } from '../src/document.js'
import { parseRecords } from '../src/record.js'
import { SectionTag } from '../src/tags.js'

const root = join(__dirname, '../../..')
const files = ['docs/experiments', 'fixtures', 'scratch'].flatMap((d) =>
  readdirSync(join(root, d), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.hwp'))
    .map((f) => join(root, d, f)),
)

/** 모든 TABLE 레코드 페이로드를 16진수로 모은다. `zonesOnly`면 Valid Zone Info Size부터 끝까지만. */
function tableRecords(bytes: Uint8Array, zonesOnly = false): string[] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  return c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p)).flatMap((p) => {
    const data = new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array)
    return parseRecords(maybeInflate(data, compressed))
      .filter((r) => r.tagId === SectionTag.Table)
      .map((r) => {
        const rows = r.payload[4]! | (r.payload[5]! << 8)
        return Buffer.from(zonesOnly ? r.payload.subarray(18 + 2 * rows + 2) : r.payload).toString('hex')
      })
  })
}

const tables = (doc: HwpDocument): Extract<Control, { type: 'table' }>[] =>
  doc.sections.flatMap((s) =>
    s.paragraphs.flatMap((p) =>
      p.runs.flatMap((r) => r.items.filter((i): i is Extract<Control, { type: 'table' }> => i.type === 'table')),
    ),
  )

describe('저장소 HWP 파일의 TABLE 셀 영역 바이트 왕복', () => {
  // 표 속성(표 76)의 bit 2 위 비트와 표 순서는 아직 원본대로 쓰지 않아 셀 영역 부분만 비교한다.
  it.each(files.map((f) => [f.slice(root.length + 1), f]))('%s', (_, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    expect(tableRecords(serializeHwp(parseHwp(bytes)), true).sort()).toEqual(tableRecords(bytes, true).sort())
  })
})

describe('셀 영역(Valid Zone Info, 표 78)', () => {
  it('한글이 저장한 셀 영역을 0부터 센 주소와 테두리 인덱스로 읽는다', () => {
    const file = join(root, 'fixtures/kogl_hwp/보령시 주간행사계획(5. 12. ~ 5. 18.).hwp')
    const zoned = tables(parseHwp(new Uint8Array(readFileSync(file)))).filter((t) => t.cellZones)
    expect(zoned.length).toBeGreaterThan(0)
    // TABLE 레코드의 영역: 열 0~2, 행 0~2, 테두리 참조 18(1부터 셈).
    expect(zoned[0]!.cellZones).toEqual([{ startRow: 0, startCol: 0, endRow: 2, endCol: 2, borderFillId: 17 }])
  })

  it('모델의 셀 영역을 써서 다시 읽는다', () => {
    const doc = new DocumentBuilder().table([['a', 'b'], ['c', 'd']]).build()
    tables(doc)[0]!.cellZones = [
      { startRow: 0, startCol: 1, endRow: 1, endCol: 1, borderFillId: 0 },
      { startRow: 1, startCol: 0, endRow: 1, endCol: 0 },
    ]
    const bytes = serializeHwp(doc)
    expect(tables(parseHwp(bytes))[0]!.cellZones).toEqual(tables(doc)[0]!.cellZones)
    // 개수 2, 첫 영역: 열 1, 행 0, 열 1, 행 1, 참조 1. 둘째 영역의 참조 0은 없음.
    expect(tableRecords(bytes)[0]!.slice(-44)).toBe('0200' + '0100000001000100' + '0100' + '0000010000000100' + '0000')
  })

  it('범위를 벗어난 주소는 쓰지 않는다', () => {
    const doc = new DocumentBuilder().table([['a']]).build()
    tables(doc)[0]!.cellZones = [{ startRow: -1, startCol: 0, endRow: 0, endCol: 0 }]
    expect(() => serializeHwp(doc)).toThrow(RangeError)
  })
})
