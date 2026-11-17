import { DocumentBuilder } from '@js-hwp/core'
import { find, read } from 'cfb'
import { describe, expect, it } from 'vitest'
import { parseHwp, serializeHwp } from '../src/document.js'
import { parseRecords } from '../src/record.js'
import { DocInfoTag, SectionTag } from '../src/tags.js'

function uncompressedStream(file: Uint8Array, path: string): Uint8Array {
  const content = find(read(file, { type: 'array' }), `/${path}`)?.content
  if (!content) throw new Error(`${path} 스트림이 없습니다.`)
  return Uint8Array.from(content)
}

describe('HWP 5 기록 구조', () => {
  const file = serializeHwp(new DocumentBuilder().paragraph('안녕하세요').build(), {
    compress: false,
  })

  it('DocInfo 리소스를 ID 매핑 레코드 아래에 배치한다', () => {
    const records = parseRecords(uncompressedStream(file, 'DocInfo'))
    expect(records[0]).toMatchObject({ tagId: DocInfoTag.DocumentProperties, level: 0 })
    expect(records[1]).toMatchObject({ tagId: DocInfoTag.IdMappings, level: 0 })
    expect(records.filter((record) => record.tagId === DocInfoTag.FaceName).length).toBeGreaterThan(0)
    for (const record of records.slice(2)) expect(record.level).toBe(1)
  })

  it('채우기가 없는 테두리 뒤에 필수 추가 채우기 길이를 기록한다', () => {
    const border = parseRecords(uncompressedStream(file, 'DocInfo')).find(
      (record) => record.tagId === DocInfoTag.BorderFill,
    )
    expect(border?.payload.length).toBe(40)
    const view = new DataView(border!.payload.buffer, border!.payload.byteOffset)
    expect(view.getUint32(32, true)).toBe(0) // 채우기 없음
    expect(view.getUint32(36, true)).toBe(0) // 추가 채우기 길이
  })

  it('빈 문단에는 PARA_TEXT를 쓰지 않는다 — 한글이 손상된 파일로 거부한다', () => {
    const empty = serializeHwp(new DocumentBuilder().paragraph('x').paragraph('').build(), { compress: false })
    const records = parseRecords(uncompressedStream(empty, 'BodyText/Section0'))
    const last = records.findLastIndex((record) => record.tagId === SectionTag.ParaHeader)
    expect(records[last + 1]?.tagId).toBe(SectionTag.ParaCharShape)
  })

  it('문서 버전에서 요구하는 문단 헤더 확장을 기록한다', () => {
    const records = parseRecords(uncompressedStream(file, 'BodyText/Section0'))
    const header = records.find(
      (record) => record.tagId === SectionTag.ParaHeader,
    )
    expect(header?.payload.length).toBe(24)

    const text = records.find((record) => record.tagId === SectionTag.ParaText)!
    const view = new DataView(text.payload.buffer, text.payload.byteOffset)
    expect(view.getUint16(text.payload.length - 2, true)).toBe(0x0d)
    const packedCount = new DataView(header!.payload.buffer, header!.payload.byteOffset).getUint32(0, true)
    expect(packedCount >>> 31).toBe(1)
    expect(text.payload.length / 2).toBe(packedCount & 0x7fffffff)

    const shapes = records.find((record) => record.tagId === SectionTag.ParaCharShape)!
    expect(new DataView(shapes.payload.buffer, shapes.payload.byteOffset).getUint32(0, true)).toBe(0)
  })

  it('구역 컨트롤 ID를 포함하고 구역 및 각주/미주 레코드를 완전하게 기록한다', () => {
    const records = parseRecords(uncompressedStream(file, 'BodyText/Section0'))
    const text = records.find((record) => record.tagId === SectionTag.ParaText)!.payload
    expect(Array.from(text.slice(0, 8))).toEqual([2, 0, 0x64, 0x63, 0x65, 0x73, 0, 0])
    expect(records.find((record) => record.tagId === SectionTag.CtrlHeader)?.payload.length).toBeGreaterThanOrEqual(30)
    expect(records.filter((record) => record.tagId === SectionTag.FootnoteShape).map((record) => record.payload.length)).toEqual([28, 28])
  })

  it('표 개체와 셀 헤더를 명세에 지정된 크기로 기록한다', () => {
    const tableFile = serializeHwp(new DocumentBuilder().table([['셀']]).build(), {
      compress: false,
    })
    const records = parseRecords(uncompressedStream(tableFile, 'BodyText/Section0'))
    const tableControl = records.find(
      (record) => record.tagId === SectionTag.CtrlHeader &&
        Array.from(record.payload.slice(0, 4)).join(',') === '32,108,98,116',
    )
    expect(tableControl?.payload.length).toBe(46)
    expect(records.find((record) => record.tagId === SectionTag.Table)?.payload.length).toBe(24)
    expect(records.find((record) => record.tagId === SectionTag.ListHeader)?.payload.length).toBe(47)
    const cellHeader = records.findIndex((record) => record.tagId === SectionTag.ListHeader)
    expect(records[cellHeader + 1]).toMatchObject({ tagId: SectionTag.ParaHeader, level: 2 })
    for (const header of records.filter((record) => record.tagId === SectionTag.ParaHeader &&
      new DataView(record.payload.buffer, record.payload.byteOffset).getUint16(16, true) === 1)) {
      expect(records.some((record) => record.tagId === SectionTag.ParaLineSeg &&
        record.level === header.level + 1)).toBe(true)
    }
    const table = parseHwp(tableFile).sections[0]?.paragraphs[0]?.runs[0]?.items[0]
    expect(table?.type).toBe('table')
    if (table?.type === 'table') {
      expect(table.rows[0]?.cells[0]?.paragraphs[0]?.runs[0]?.items).toEqual([
        { type: 'text', value: '셀' },
      ])
    }
  })
})
