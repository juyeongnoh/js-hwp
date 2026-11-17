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

/** 구역마다 문단 머리의 단 나누기 종류(오프셋 11) 목록. */
function divideSorts(bytes: Uint8Array): number[][] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  return c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p)).map((p) =>
    parseRecords(maybeInflate(new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array), compressed))
      .filter((r) => r.tagId === SectionTag.ParaHeader)
      .map((r) => r.payload[11]!),
  )
}

describe('저장소 HWP 파일의 문단 단 나누기 종류 왕복', () => {
  it.each(files.map((f) => [f.slice(root.length + 1), f]))('%s', (_, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    expect(divideSorts(serializeHwp(parseHwp(bytes)))).toEqual(divideSorts(bytes))
  })
})
