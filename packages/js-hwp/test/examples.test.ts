import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DocumentBuilder, documentText, open, save, tables } from '../src/index.js'

// 예제는 사람들이 복사해가는 문서이므로, 거기서 하는 API 호출이 계속 동작해야
// 한다. 이 테스트가 파일 입출력 없이 같은 호출을 돌린다.
describe('examples still compile against the API', () => {
  it('create-report builds', () => {
    const doc = new DocumentBuilder()
      .meta({ title: 't', author: 'a', keywords: ['k'] })
      .page({ paper: 'A4', margins: { left: '30mm', right: '30mm', top: '20mm' } })
      .header((p) => p.text('h', { size: 9, color: '#808080' }))
      .footer((p) => p.text('f', { size: 9 }))
      .heading(1, '1. 개요')
      .paragraph('본문', { spaceAfter: 6 })
      .paragraph((p) =>
        p.text('a ').bold('b').text(' c', { color: '#c00000', bold: true }).footnote('note'),
      )
      .table([['h1', 'h2'], ['a', 'b']], { header: true, caption: '표 1' })
      .list(['x', 'y'], { kind: 'bullet' })
      .pageBreak()
      .paragraph((p) => p.text('see ').link('portal', 'https://example.com'))
      .build()

    const back = open(save(doc))
    expect(documentText(back)).toContain('본문')
    expect(tables(back).length).toBe(1)
  })
})
