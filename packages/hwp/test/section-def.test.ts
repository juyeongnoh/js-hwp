import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DocumentBuilder } from '@js-hwp/core'
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
