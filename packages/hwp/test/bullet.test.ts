import { createDocument, HeadAlign, type Bullet, type Numbering } from '@js-hwp/core'
import { describe, expect, it } from 'vitest'
import { parseDocInfo, serializeDocInfo } from '../src/docinfo.js'
import { parseRecords, serializeRecords } from '../src/record.js'
import { DocInfoTag } from '../src/tags.js'

const HEAD = [0x08, 0, 0, 0, 0, 0, 0x32, 0, 0xff, 0xff, 0xff, 0xff]

function parseBullet(payload: number[]): Bullet {
  const doc = createDocument()
  parseDocInfo(doc, serializeRecords([{ tagId: DocInfoTag.Bullet, level: 1, payload: Uint8Array.from(payload) }]))
  return doc.bullets[0]!
}

function writeBullet(bullet: Bullet): number[] {
  const doc = createDocument({ bullets: [bullet] })
  return [...parseRecords(serializeDocInfo(doc)).find(r => r.tagId === DocInfoTag.Bullet)!.payload]
}

describe('글머리표 레코드', () => {
  // 실제 파일에서 본 25B 레코드 구조. 글머리표 문자는 ○(U+25CB), 체크 문자는 공백.
  const real = [...HEAD, 0xcb, 0x25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x20, 0]

  it('머리 정보 바로 뒤의 글머리표 문자와 23번 오프셋의 체크 문자를 읽는다', () => {
    const bullet = parseBullet(real)
    expect(bullet.char).toBe('○')
    expect(bullet.checkedChar).toBe(' ')
    expect(bullet.image).toBeUndefined()
    expect(bullet.level.format).toBe('')
  })

  it('문자 코드가 작아도 번호 형식 길이로 오해하지 않는다', () => {
    expect(parseBullet([...HEAD, 0x01, 0, 0, 0, 0, 0]).char).toBe('\u0001')
  })

  it('실제 레코드를 바이트 그대로 다시 쓴다', () => {
    expect(writeBullet(parseBullet(real))).toEqual(real)
  })

  it.each([14, 23])('%iB짜리 짧은 레코드도 읽는다', length => {
    const bullet = parseBullet(real.slice(0, length))
    expect(bullet.char).toBe('○')
    expect(bullet.checkedChar).toBeUndefined()
  })

  it('이미지 글머리표 정보를 보존한다', () => {
    const image = { contrast: 75, brightness: 50, effect: 0, binDataId: 0 }
    const bullet = parseBullet(writeBullet({ ...parseBullet(real), image }))
    expect(bullet.image).toEqual(image)
  })
})

describe('문단 번호 레코드', () => {
  it('수준마다 번호 형식 문자열을 함께 쓰고 읽는다', () => {
    const doc = createDocument({
      numberings: [{ levels: [{ format: '^1.', numberFormat: 0, align: 0, widthAdjust: 0, distance: 50 }] }],
    })
    const back = createDocument()
    parseDocInfo(back, serializeDocInfo(doc))
    expect(back.numberings[0]!.levels[0]!.format).toBe('^1.')
    expect(back.numberings[0]!.levels[1]!.format).toBe('^2.')
  })

  // 한글 5.1.1.0이 저장한 기본 개요 번호 레코드(docs/experiments/numbering-format-bits/base-format-14.hwp).
  const real = Buffer.from(
    '0c00000000003200ffffffff03005e0031002e000c01000000003200ffffffff03005e0032002e00' +
      '0c00000000003200ffffffff03005e00330029000c01000000003200ffffffff03005e0034002900' +
      '0c00000000003200ffffffff040028005e00350029000c01000000003200ffffffff040028005e0036002900' +
      '2c00000000003200ffffffff02005e00370001000100000001000000010000000100000001000000' +
      '01000000010000002c01000000003200ffffffff02005e0038004c01000000003200ffffffff0000' +
      '6c00000000003200ffffffff0000010000000100000001000000',
    'hex',
  )

  function parseNumbering(payload: Uint8Array) {
    const doc = createDocument()
    parseDocInfo(doc, serializeRecords([{ tagId: DocInfoTag.Numbering, level: 1, payload }]))
    return doc.numberings[0]!
  }

  function writeNumbering(numbering: Numbering): number[] {
    const doc = createDocument({ numberings: [numbering] })
    return [...parseRecords(serializeDocInfo(doc)).find(r => r.tagId === DocInfoTag.Numbering)!.payload]
  }

  it('수준별 시작번호와 8~10수준을 읽는다', () => {
    const numbering = parseNumbering(real)
    expect(real.length).toBe(230)
    expect(numbering.levels.map(l => l.format)).toEqual(['^1.', '^2.', '^3)', '^4)', '(^5)', '(^6)', '^7', '^8', '', ''])
    expect(numbering.levels.map(l => l.startNumber)).toEqual(Array(10).fill(1))
    expect(numbering.levels.slice(7).map(l => l.numberFormat)).toEqual([9, 10, 3])
  })

  it('실제 레코드를 바이트 그대로 다시 쓴다', () => {
    expect(writeNumbering(parseNumbering(real))).toEqual([...real])
  })

  it('5.0.x처럼 수준별 시작번호에서 끝나는 레코드는 7수준만 읽는다', () => {
    const numbering = parseNumbering(real.subarray(0, 172))
    expect(numbering.levels).toHaveLength(7)
    expect(numbering.levels[6]!.startNumber).toBe(1)
  })

  it('8~10수준이 없으면 한글 기본값으로 채워 쓴다', () => {
    const seven = parseNumbering(real.subarray(0, 172))
    expect(writeNumbering(seven)).toEqual([...real])
  })
})

describe('문단 머리 정렬', () => {
  it.each([
    [HeadAlign.Left, 0],
    [HeadAlign.Center, 1],
    [HeadAlign.Right, 2],
  ])('HeadAlign %i은 속성 비트 0-1에 %i로 저장된다', (align, value) => {
    const doc = createDocument({ bullets: [{ char: '•', level: { format: '', numberFormat: 0, align, widthAdjust: 0, distance: 50 } }] })
    const payload = parseRecords(serializeDocInfo(doc)).find(r => r.tagId === DocInfoTag.Bullet)!.payload
    expect(payload[0]! & 3).toBe(value)
  })

  it('왼쪽 정렬 비트를 양쪽 정렬이 아니라 왼쪽으로 읽는다', () => {
    expect(parseBullet([0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0x22, 0x20]).level.align).toBe(HeadAlign.Left)
  })
})

describe('문단 머리 번호 형식', () => {
  // 한글이 저장한 실제 속성 값. 0x1CC = ㊀㊁㊂(14), 0x20C = 甲乙丙(16).
  it.each([
    [0x1cc, 14],
    [0x20c, 16],
  ])('속성 %#x의 비트 5-9를 번호 형식 %i로 읽는다', (properties, format) => {
    const head = [properties & 0xff, properties >> 8, 0, 0, 0, 0, 0x32, 0, 0xff, 0xff, 0xff, 0xff]
    expect(parseBullet([...head, 0x22, 0x20]).level.numberFormat).toBe(format)
  })

  it('번호 형식 16을 비트 9에 쓴다', () => {
    const doc = createDocument({ bullets: [{ char: '•', level: { format: '', numberFormat: 16, align: 0, widthAdjust: 0, distance: 50 } }] })
    const payload = parseRecords(serializeDocInfo(doc)).find(r => r.tagId === DocInfoTag.Bullet)!.payload
    expect(payload[1]! & 0x03).toBe(0x02)
  })
})
