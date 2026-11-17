import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')

/** 문단마다 [range tag 수, 줄 정보 수, LINE_SEG 바이트, RANGE_TAG 바이트]. */
function layouts(bytes: Uint8Array): string[] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  const out: string[] = []
  for (const p of c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p))) {
    const records = parseRecords(maybeInflate(new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array), compressed))
    let current: string[] | undefined
    for (const r of records) {
      if (r.tagId === SectionTag.ParaHeader) {
        if (current) out.push(current.join('|'))
        const v = new DataView(r.payload.buffer, r.payload.byteOffset)
        current = [String(v.getUint16(14, true)), String(v.getUint16(16, true)), '', '']
      } else if (current && r.tagId === SectionTag.ParaLineSeg) current[2] = hex(r.payload)
      else if (current && r.tagId === SectionTag.ParaRangeTag) current[3] = hex(r.payload)
    }
    if (current) out.push(current.join('|'))
  }
  return out
}

describe('저장소 HWP 파일의 줄 배치·영역 태그 왕복', () => {
  it.each(files.map((f) => [f.slice(root.length + 1), f]))('%s', (_, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    expect(layouts(serializeHwp(parseHwp(bytes)))).toEqual(layouts(bytes))
  })
})

describe('영역 태그', () => {
  it('종류와 데이터를 태그 UINT32 하나로 합쳐 쓰고 다시 나눠 읽는다', () => {
    const doc = parseHwp(new Uint8Array(readFileSync(files[0]!)))
    const tags = [
      { start: 0, end: 3, kind: 0xff, data: 0xabcdef },
      { start: 1, end: 2, kind: 2, data: 0 },
    ]
    doc.sections[0]!.paragraphs[0]!.rangeTags = tags
    const bytes = serializeHwp(doc)
    const [count, , , payload] = layouts(bytes)[0]!.split('|')
    expect(count).toBe('2')
    expect(payload).toBe('00000000' + '03000000' + 'efcdabff' + '01000000' + '02000000' + '00000002')
    expect(parseHwp(bytes).sections[0]!.paragraphs[0]!.rangeTags).toEqual(tags)
  })

  it('범위를 벗어난 종류는 거부한다', () => {
    const doc = parseHwp(new Uint8Array(readFileSync(files[0]!)))
    doc.sections[0]!.paragraphs[0]!.rangeTags = [{ start: 0, end: 1, kind: 256, data: 0 }]
    expect(() => serializeHwp(doc)).toThrow()
  })
})
