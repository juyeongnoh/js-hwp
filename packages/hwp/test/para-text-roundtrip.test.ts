import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DocumentBuilder, type InlineItem } from '@js-hwp/core'
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

/** PARA_TEXT의 단 정의(`cold`)·구역 정의(`secd`) 컨트롤 8칸. */
const COLD = '0200' + '646c6f63' + '0000'.repeat(4) + '0200'
const SECD = '0200' + '64636573' + '0000'.repeat(4) + '0200'

/**
 * 구역 첫 문단의 `cold → secd`를 쓰기 코드가 내는 `secd → cold`로 맞춘다. 한글이 이 순서로
 * 저장하는지 확인하기 전까지는 보존하지 않는다(BACKLOG "구역 첫 문단에서 `cold`가 `secd`보다 먼저 오는 파일").
 */
const normalizeSectionControls = (text: string): string =>
  text.startsWith(COLD + SECD) ? SECD + COLD + text.slice(COLD.length * 2) : text

/** 문단마다 PARA_HEADER의 문자 수·controlMask(앞 8바이트)와 PARA_TEXT 페이로드. */
function paragraphs(bytes: Uint8Array): string[] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  const out: string[] = []
  const walk = (n: RecordNode): void => {
    if (n.tagId === SectionTag.ParaHeader) {
      const text = n.children.find((child) => child.tagId === SectionTag.ParaText)
      out.push(`${hex(n.payload.subarray(0, 8))}:${text ? normalizeSectionControls(hex(text.payload)) : ''}`)
    }
    n.children.forEach(walk)
  }
  for (const p of c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p))) {
    const data = new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array)
    buildRecordTree(parseRecords(maybeInflate(data, compressed))).forEach(walk)
  }
  return out
}

/**
 * 문단마다 PARA_HEADER 전체와 PARA_CHAR_SHAPE 항목. 같은 위치에 겹친 항목은 마지막 것만 적용되므로
 * 그것만 남기고, 헤더의 글자 모양 수(오프셋 12)도 그 개수로 맞춘다(`scratch/ul2-vs-strike.hwp`).
 */
function paragraphHeads(bytes: Uint8Array): string[] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  const out: string[] = []
  const walk = (n: RecordNode): void => {
    if (n.tagId === SectionTag.ParaHeader) {
      const record = n.children.find((child) => child.tagId === SectionTag.ParaCharShape)
      const shapes = new Map<number, number>()
      if (record) {
        const view = new DataView(record.payload.buffer, record.payload.byteOffset, record.payload.byteLength)
        for (let i = 0; i + 8 <= view.byteLength; i += 8) shapes.set(view.getUint32(i, true), view.getUint32(i + 4, true))
      }
      const head = Buffer.from(n.payload)
      head.writeUInt16LE(shapes.size, 12)
      out.push(`${head.toString('hex')}:${[...shapes].map(([p, id]) => `${p}=${id}`).join(',')}`)
    }
    n.children.forEach(walk)
  }
  for (const p of c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p))) {
    const data = new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array)
    buildRecordTree(parseRecords(maybeInflate(data, compressed))).forEach(walk)
  }
  return out
}

describe('저장소 HWP 파일의 문단 텍스트 왕복', () => {
  it.each(files.map((f) => [f.slice(root.length + 1), f]))('%s', (_, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    expect(paragraphs(serializeHwp(parseHwp(bytes)))).toEqual(paragraphs(bytes))
  })
})

describe('저장소 HWP 파일의 문단 헤더와 글자 모양 왕복', () => {
  it.each(files.map((f) => [f.slice(root.length + 1), f]))('%s', (_, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    expect(paragraphHeads(serializeHwp(parseHwp(bytes)))).toEqual(paragraphHeads(bytes))
  })
})

describe('문단 끝과 구역 정의 자리의 글자 모양', () => {
  const read = (path: string) => parseHwp(new Uint8Array(readFileSync(join(root, path))))

  const gyeonggi = 'fixtures/kogl_hwp/1.경기도민＋79％＋올＋추석＋고향방문＋계획＋‘없다’(1).hwp'

  it('빈 문단은 문단 끝 글자 모양을 run으로 읽는다', () => {
    // 원본 PARA_CHAR_SHAPE [0:10]
    const paragraph = read(gyeonggi).sections[0]!.paragraphs[12]!
    expect(paragraph.runs).toEqual([{ charShapeId: 10, items: [] }])
    expect(paragraph.paraEndCharShapeId).toBeUndefined()
  })

  it('마지막 run과 다른 문단 끝 글자 모양을 paraEndCharShapeId로 읽는다', () => {
    // 원본 PARA_CHAR_SHAPE [0:7, 32:21], 문자 수 33
    const paragraph = read(gyeonggi).sections[0]!.paragraphs[0]!
    expect(paragraph.runs.map((run) => run.charShapeId)).toEqual([7])
    expect(paragraph.paraEndCharShapeId).toBe(21)
  })

  it('구역 정의 자리의 글자 모양을 sectionControlCharShapeId로 읽는다', () => {
    // 원본 PARA_CHAR_SHAPE [0:4, 16:5]
    const paragraph = read('fixtures/kogl_hwp/2015 생활체육 수기공모전 제출양식.hwp').sections[0]!.paragraphs[0]!
    expect(paragraph.sectionControlCharShapeId).toBe(4)
    expect(paragraph.runs[0]!.charShapeId).toBe(5)
  })

  it('새 문단에 paraEndCharShapeId를 주면 문단 끝 위치에 글자 모양을 쓴다', () => {
    const doc = new DocumentBuilder().paragraph('가').build()
    doc.sections[0]!.paragraphs[0]!.paraEndCharShapeId = 3
    const [entry] = paragraphHeads(serializeHwp(doc))
    // secd·cold 16칸 + 가 = 문단 끝은 위치 17
    expect(entry!.split(':')[1]).toBe('0=0,17=3')
  })
})

describe('문단 텍스트 쓰기', () => {
  /** 첫 문단의 [PARA_HEADER 앞 8바이트, PARA_TEXT]. 구역 정의·단 정의 컨트롤 32바이트가 앞에 붙는다. */
  const write = (items: InlineItem[]): [Buffer, string] => {
    const doc = new DocumentBuilder().paragraph('가').build()
    doc.sections[0]!.paragraphs[0]!.runs[0]!.items.push(...items)
    const [head, text] = paragraphs(serializeHwp(doc))[0]!.split(':')
    return [Buffer.from(head!, 'hex'), text!.slice(32 * 2)]
  }

  it('탭 뒤 코드 단위를 보존하고 폭은 width로 덮는다', () => {
    const [, text] = write([{ type: 'tab', width: 0x12345, textData: [0xffff, 0xffff, 0x0100, 0, 0, 7] }])
    // 가, 탭(폭 0x00012345, 0x0100, 0, 0, 7), 문단 끝
    expect(text).toBe('00ac' + '0900' + '45230100' + '0001' + '00000000' + '0700' + '0900' + '0d00')
  })

  it('textData 없는 탭은 폭 뒤를 0으로 채운다', () => {
    const [, text] = write([{ type: 'tab', width: 4000 }])
    expect(text).toBe('00ac' + '0900' + 'a00f0000' + '0000'.repeat(4) + '0900' + '0d00')
  })

  it('하이픈, 묶음 빈칸, 고정폭 빈칸이 든 문단은 controlMask에 그 비트를 켠다', () => {
    const [head] = write([
      { type: 'specialChar', char: 'hyphen' },
      { type: 'specialChar', char: 'nbsp' },
      { type: 'specialChar', char: 'fixedWidthSpace' },
    ])
    // 0x02(구역·단 정의) | 0x18 | 0x1E | 0x1F
    expect(head.readUInt32LE(4)).toBe(((1 << 0x02) | (1 << 0x18) | (1 << 0x1e) | (1 << 0x1f)) >>> 0)
  })
})
