import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DocumentBuilder, FieldKind } from '@js-hwp/core'
import CFB from 'cfb'
import { describe, expect, it } from 'vitest'
import { maybeInflate } from '../src/compress.js'
import { parseHwp, serializeHwp } from '../src/document.js'
import { parseRecords } from '../src/record.js'
import { SectionTag } from '../src/tags.js'

const dir = join(__dirname, '../../../docs/experiments/section-memo-shape-id')
const files = readdirSync(dir).filter((f) => f.endsWith('.hwp'))

/** 압축을 푼 `BodyText/Section{N}` 스트림들. */
function sectionStreams(bytes: Uint8Array): string[] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const compressed = ((CFB.find(c, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
  return c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p)).map((p) =>
    Buffer.from(maybeInflate(new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array), compressed)).toString('hex'),
  )
}

describe('메모 (정오표 71)', () => {
  const doc = parseHwp(new Uint8Array(readFileSync(join(dir, 'base-two-memo-shapes.hwp'))))

  it('마지막 구역 끝의 메모 목록을 읽는다', () => {
    expect(doc.sections[0]!.memos).toBeUndefined()
    const memos = doc.sections[1]!.memos!
    expect(memos.map((m) => m.id)).toEqual([1, 2])
    expect(memos.map((m) => m.paragraphs[0]!.runs.flatMap((r) => r.items))).toEqual([
      [{ type: 'text', value: 'memo one' }],
      [{ type: 'text', value: 'memo two' }],
    ])
  })

  it('본문의 메모 자리를 메모 필드로 읽는다', () => {
    const begin = doc.sections[0]!.paragraphs[0]!.runs.flatMap((r) => r.items).find((i) => i.type === 'fieldBegin')
    expect(begin).toMatchObject({ fieldKind: FieldKind.Memo, ctrlId: '%unk', editable: true, dirty: true })
    if (begin?.type !== 'fieldBegin') return
    expect(begin.command).toMatch(/^MEMO\//)
    expect([...begin.trailing!]).toEqual([1, 0, 0, 0])
  })

  it.each(files)('%s의 구역 스트림을 바이트 그대로 다시 쓴다', (file) => {
    const bytes = new Uint8Array(readFileSync(join(dir, file)))
    expect(sectionStreams(serializeHwp(parseHwp(bytes)))).toEqual(sectionStreams(bytes))
  })
})

describe('필드 CTRL_HEADER (표 154)', () => {
  it('새 하이퍼링크의 명령 문자열을 CTRL_HEADER에 쓴다', () => {
    const bytes = serializeHwp(new DocumentBuilder().paragraph((p) => p.link('한컴', 'https://hancom.com')).build())
    const c = CFB.read(bytes, { type: 'buffer' })
    const compressed = ((CFB.find(c, 'FileHeader')!.content as Uint8Array)[36]! & 1) === 1
    const records = parseRecords(maybeInflate(new Uint8Array(CFB.find(c, '/BodyText/Section0')!.content as Uint8Array), compressed))
    const field = records.find((r) => r.tagId === SectionTag.CtrlHeader && Buffer.from(r.payload.subarray(0, 4)).toString('latin1') === 'klh%')!
    expect(records.some((r) => r.tagId === SectionTag.CtrlData)).toBe(false)
    const command = 'https://hancom.com;;0;;'
    expect(field.payload.length).toBe(4 + 4 + 1 + 2 + command.length * 2 + 4)
    const begin = parseHwp(bytes).sections[0]!.paragraphs[0]!.runs.flatMap((r) => r.items).find((i) => i.type === 'fieldBegin')
    expect(begin).toMatchObject({ fieldKind: FieldKind.HyperLink, command })
  })
})
