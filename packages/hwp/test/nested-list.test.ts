import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
const LIST_CONTROLS = ['head', 'foot', 'fn  ', 'en  ', 'tcmt', 'secd']

function sections(bytes: Uint8Array): RecordNode[][] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  return c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p)).map((p) =>
    buildRecordTree(parseRecords(maybeInflate(new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array), compressed))),
  )
}

/** 문단 리스트를 가진 컨트롤마다: 페이로드, 그리고 LIST_HEADER와 형제 문단의 (레벨, 태그, 바이트). */
function listControls(bytes: Uint8Array): string[][] {
  const out: string[][] = []
  const walk = (n: RecordNode): void => {
    if (n.tagId === SectionTag.CtrlHeader) {
      const id = Buffer.from(n.payload.subarray(0, 4)).reverse().toString()
      if (LIST_CONTROLS.includes(id)) {
        out.push([
          hex(n.payload),
          ...n.children
            .filter((c) => c.tagId === SectionTag.ListHeader || c.tagId === SectionTag.ParaHeader)
            .map((c) => `${c.level}:${c.tagId}:${hex(c.payload)}`),
        ])
      }
    }
    n.children.forEach(walk)
  }
  sections(bytes).flat().forEach(walk)
  return out
}

describe('문단 리스트를 가진 컨트롤과 바탕쪽 왕복', () => {
  it.each(files.map((f) => [f.slice(root.length + 1), f]))('%s', (_, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    expect(listControls(serializeHwp(parseHwp(bytes)))).toEqual(listControls(bytes))
  })
})
