import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Control, type HwpDocument, walkParagraphs } from '@js-hwp/core'
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

/** 본문의 `pghd` CTRL_HEADER 페이로드(16진수). */
function pageHidings(bytes: Uint8Array): string[] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  return c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p)).flatMap((p) =>
    parseRecords(maybeInflate(new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array), compressed))
      .filter((r) => r.tagId === SectionTag.CtrlHeader)
      .map((r) => Buffer.from(r.payload).toString('hex'))
      .filter((h) => h.startsWith('64686770')),
  )
}

function controls(doc: HwpDocument): Control[] {
  return [...walkParagraphs(doc)].flatMap(({ paragraph }) =>
    paragraph.runs.flatMap((run) => run.items).filter((item): item is Control => 'type' in item && item.type === 'pageHiding'),
  )
}

const samples = files.filter((f) => pageHidings(new Uint8Array(readFileSync(f))).length > 0)

describe('현재 쪽만 감추기(pghd)', () => {
  it('샘플에 pghd가 있다', () => {
    expect(samples.length).toBeGreaterThan(0)
  })

  it.each(samples.map((f) => [f.slice(root.length + 1), f]))('%s: 바이트 그대로 왕복한다', (_, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    expect(pageHidings(serializeHwp(parseHwp(bytes)))).toEqual(pageHidings(bytes))
  })

  it('비트를 모델 필드로 읽고, 고친 필드를 4바이트 속성으로 쓴다', () => {
    const doc = parseHwp(new Uint8Array(readFileSync(samples[0]!)))
    const [control] = controls(doc)
    expect(control?.type).toBe('pageHiding')
    if (control?.type !== 'pageHiding') return
    Object.assign(control, {
      hideHeader: true, hideFooter: false, hideMasterPage: false,
      hideBorder: false, hideFill: false, hidePageNumber: true, unknownBits: 0x100,
    })
    expect(pageHidings(serializeHwp(doc))[0]).toBe('64686770' + '21010000')
  })
})
