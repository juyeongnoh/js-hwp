import { describe, expect, it } from 'vitest'
import { ByteReader, ByteWriter, bit, bits, setBit, setBits } from '../src/bytes.js'
import { deflate, inflate } from '../src/compress.js'
import {
  DEFAULT_FLAGS,
  createFileHeader,
  formatVersion,
  parseFileHeader,
  serializeFileHeader,
} from '../src/fileheader.js'
import {
  RecordWriter,
  buildRecordTree,
  flattenRecordTree,
  parseRecords,
  serializeRecords,
} from '../src/record.js'
import { DocInfoTag, HWPTAG_BEGIN, SectionTag, tagName } from '../src/tags.js'

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)

describe('레코드 스트림', () => {
  it('단순한 레코드를 직렬화한 뒤 다시 파싱한다', () => {
    const records = [{ tagId: DocInfoTag.CharShape, level: 0, payload: bytes(1, 2, 3) }]
    const parsed = parseRecords(serializeRecords(records))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.tagId).toBe(DocInfoTag.CharShape)
    expect([...parsed[0]!.payload]).toEqual([1, 2, 3])
  })

  it('태그와 중첩 레벨 및 크기를 32비트 헤더에 묶는다', () => {
    const stream = serializeRecords([{ tagId: 0x042, level: 3, payload: bytes(0xaa, 0xbb) }])
    const header = new DataView(stream.buffer).getUint32(0, true)
    expect(header & 0x3ff).toBe(0x042)
    expect((header >>> 10) & 0x3ff).toBe(3)
    expect((header >>> 20) & 0xfff).toBe(2)
  })

  it('4095바이트 이상의 페이로드에 0xFFF 크기 확장 표시를 사용한다', () => {
    for (const size of [4094, 4095, 4096, 70_000]) {
      const payload = new Uint8Array(size).fill(7)
      const stream = serializeRecords([{ tagId: 0x100, level: 0, payload }])
      const header = new DataView(stream.buffer).getUint32(0, true)
      const escaped = ((header >>> 20) & 0xfff) === 0xfff

      expect(escaped, `size ${size} escape`).toBe(size >= 0xfff)
      expect(stream.length).toBe(size + (escaped ? 8 : 4))

      const parsed = parseRecords(stream)
      expect(parsed[0]!.payload.length, `size ${size}`).toBe(size)
    }
  })

  it('여러 레코드가 담긴 스트림을 원래 순서대로 파싱한다', () => {
    const input = [
      { tagId: SectionTag.ParaHeader, level: 0, payload: bytes(1) },
      { tagId: SectionTag.ParaText, level: 1, payload: bytes(2, 2) },
      { tagId: SectionTag.ParaCharShape, level: 1, payload: bytes(3, 3, 3) },
      { tagId: SectionTag.ParaHeader, level: 0, payload: bytes(4) },
    ]
    const parsed = parseRecords(serializeRecords(input))
    expect(parsed.map((r) => r.tagId)).toEqual(input.map((r) => r.tagId))
    expect(parsed.map((r) => r.level)).toEqual([0, 1, 1, 0])
  })

  it('잘린 마지막 레코드에서 읽을 수 있는 데이터를 복구한다', () => {
    const stream = serializeRecords([{ tagId: 0x42, level: 0, payload: bytes(1, 2, 3, 4, 5) }])
    const parsed = parseRecords(stream.subarray(0, stream.length - 2))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.payload.length).toBe(3)
  })

  it('10비트 범위를 벗어나는 태그 ID를 거부한다', () => {
    expect(() => serializeRecords([{ tagId: 0x400, level: 0, payload: bytes() }])).toThrow(/10비트/)
  })
})

describe('레코드 트리', () => {
  const flat = [
    { tagId: 1, level: 0, payload: bytes() },
    { tagId: 2, level: 1, payload: bytes() },
    { tagId: 3, level: 2, payload: bytes() },
    { tagId: 4, level: 1, payload: bytes() },
    { tagId: 5, level: 0, payload: bytes() },
  ]

  it('레벨에 따라 레코드를 중첩한다', () => {
    const roots = buildRecordTree(flat)
    expect(roots.map((r) => r.tagId)).toEqual([1, 5])
    expect(roots[0]!.children.map((c) => c.tagId)).toEqual([2, 4])
    expect(roots[0]!.children[0]!.children.map((c) => c.tagId)).toEqual([3])
  })

  it('자식 레코드에 부모 참조를 연결한다', () => {
    const roots = buildRecordTree(flat)
    expect(roots[0]!.children[0]!.parent).toBe(roots[0])
  })

  it('트리를 원래 순서의 목록으로 펼친다', () => {
    expect(flattenRecordTree(buildRecordTree(flat)).map((r) => r.tagId)).toEqual([1, 2, 3, 4, 5])
  })

  it('0이 아닌 레벨에서 시작하는 스트림을 처리한다', () => {
    const roots = buildRecordTree([
      { tagId: 1, level: 2, payload: bytes() },
      { tagId: 2, level: 3, payload: bytes() },
    ])
    expect(roots).toHaveLength(1)
    expect(roots[0]!.children).toHaveLength(1)
  })
})

describe('RecordWriter 레코드 작성기', () => {
  it('중첩 레벨을 추적한다', () => {
    const writer = new RecordWriter()
    writer.nested(1, bytes(), () => {
      writer.write(2, bytes())
      writer.nested(3, bytes(), () => writer.write(4, bytes()))
    })
    writer.write(5, bytes())

    expect(writer.records.map((r) => [r.tagId, r.level])).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 2],
      [5, 0],
    ])
  })

  it('콜백에서 예외가 발생해도 레벨을 복원한다', () => {
    const writer = new RecordWriter()
    expect(() =>
      writer.nested(1, bytes(), () => {
        throw new Error('테스트용 오류')
      }),
    ).toThrow('테스트용 오류')
    expect(writer.level).toBe(0)
  })
})

describe('기본 바이트 입출력', () => {
  it('모든 바이트 폭의 정수를 기록한 뒤 다시 읽는다', () => {
    const writer = new ByteWriter()
    writer.uint8(200).int8(-100).uint16(60_000).int16(-30_000).uint32(4_000_000_000).int32(-2_000_000)
    const reader = new ByteReader(writer.finish())
    expect(reader.uint8()).toBe(200)
    expect(reader.int8()).toBe(-100)
    expect(reader.uint16()).toBe(60_000)
    expect(reader.int16()).toBe(-30_000)
    expect(reader.uint32()).toBe(4_000_000_000)
    expect(reader.int32()).toBe(-2_000_000)
  })

  it('COLORREF를 읽고 쓸 때 바이트 순서를 변환한다', () => {
    // 디스크에는 R, G, B, 최상위 바이트 순서로 저장된다.
    const color = { r: 0x12, g: 0x34, b: 0x56, unknown: 0 }
    const writer = new ByteWriter().color(color)
    const raw = writer.finish()
    expect([...raw]).toEqual([0x12, 0x34, 0x56, 0x00])
    expect(new ByteReader(raw).color()).toEqual(color)
  })

  // 실제 파일에 있는 값들.
  it.each([
    [[0xff, 0xff, 0xff, 0xff], { r: 0xff, g: 0xff, b: 0xff, unknown: 0xff }],
    [[0x00, 0x00, 0x00, 0xff], { r: 0, g: 0, b: 0, unknown: 0xff }],
    [[0xff, 0xff, 0xff, 0xc0], { r: 0xff, g: 0xff, b: 0xff, unknown: 0xc0 }],
    [[0x12, 0x34, 0x56, 0x80], { r: 0x12, g: 0x34, b: 0x56, unknown: 0x80 }],
  ])('COLORREF %j의 최상위 바이트를 보존한다', (bytes, model) => {
    const raw = Uint8Array.from(bytes)
    expect(new ByteReader(raw).color()).toEqual(model)
    expect([...new ByteWriter().color(model).finish()]).toEqual(bytes)
  })

  it('한글을 포함한 UTF-16 문자열을 기록한 뒤 다시 읽는다', () => {
    const writer = new ByteWriter().string('함초롬바탕').string('')
    const reader = new ByteReader(writer.finish())
    expect(reader.string()).toBe('함초롬바탕')
    expect(reader.string()).toBe('')
  })

  it('청크 단위 디코딩이 필요한 긴 문자열을 처리한다', () => {
    const long = '가'.repeat(10_000)
    const reader = new ByteReader(new ByteWriter().string(long).finish())
    expect(reader.string()).toBe(long)
  })

  it('레코드 끝을 넘어가는 선택 필드는 기본값을 반환한다', () => {
    const reader = new ByteReader(new ByteWriter().uint16(5).finish())
    expect(reader.uint16()).toBe(5)
    expect(reader.optionalUint32(42)).toBe(42)
    expect(reader.optionalString('none')).toBe('none')
  })

  it('선택 문자열이 잘렸을 때 길이 접두부를 소비하지 않는다', () => {
    // "글자 8개"라고 말하는 WORD 뒤에 글자가 하나도 없다.
    const reader = new ByteReader(new ByteWriter().uint16(8).finish())
    expect(reader.optionalString('fallback')).toBe('fallback')
    expect(reader.offset).toBe(0)
  })

  it('필수 필드가 레코드 끝을 넘어가면 위치 정보를 포함한 예외를 던진다', () => {
    const reader = new ByteReader(bytes(1))
    expect(() => reader.uint32()).toThrow(/레코드가 예상보다 일찍 끝났습니다/)
  })
})

describe('비트 필드 도우미', () => {
  it('비트 범위를 추출하고 설정한다', () => {
    expect(bits(0b1101_0010, 1, 4)).toBe(0b1001)
    expect(bit(0b1000, 3)).toBe(true)
    expect(bit(0b1000, 2)).toBe(false)
    expect(setBits(0, 4, 7, 0b1010)).toBe(0b1010_0000)
    expect(setBit(0, 5, true)).toBe(32)
    expect(setBit(0xff, 0, false)).toBe(0xfe)
  })
})

describe('압축', () => {
  it('raw DEFLATE로 압축한 뒤 원본으로 복원한다', () => {
    const data = new TextEncoder().encode('안녕하세요 '.repeat(500))
    const compressed = deflate(data)
    expect(compressed.length).toBeLessThan(data.length)
    expect(inflate(compressed)).toEqual(data)
  })

  it('호환성 대체 경로로 zlib 래퍼가 있는 데이터를 허용한다', () => {
    // 78 9C가 흔한 zlib 헤더다. 감싼 deflate로 하나 만든다.
    const data = new TextEncoder().encode('hello '.repeat(100))
    const raw = deflate(data)
    const wrapped = new Uint8Array(raw.length + 6)
    wrapped.set([0x78, 0x9c])
    wrapped.set(raw, 2)
    // 페이로드의 Adler-32.
    let a = 1
    let b = 0
    for (const byte of data) {
      a = (a + byte) % 65521
      b = (b + a) % 65521
    }
    const view = new DataView(wrapped.buffer)
    view.setUint32(wrapped.length - 4, ((b << 16) | a) >>> 0, false)
    expect(inflate(wrapped)).toEqual(data)
  })

  it('DEFLATE 형식이 아닌 데이터에 원인을 파악할 수 있는 오류를 보고한다', () => {
    expect(() => inflate(bytes(1, 2, 3, 4, 5, 6, 7, 8))).toThrow(/스트림 압축 해제에 실패했습니다/)
  })

  it('빈 입력을 그대로 반환한다', () => {
    expect(inflate(new Uint8Array(0))).toEqual(new Uint8Array(0))
  })
})

describe('FileHeader 파일 헤더', () => {
  it('기본 헤더를 직렬화한 뒤 다시 파싱한다', () => {
    const header = createFileHeader({ major: 5, minor: 1, build: 1, revision: 0 })
    const parsed = parseFileHeader(serializeFileHeader(header))
    expect(parsed.version).toEqual({ major: 5, minor: 1, build: 1, revision: 0 })
    expect(parsed.flags).toEqual(DEFAULT_FLAGS)
  })

  it('정확히 256바이트를 기록한다', () => {
    expect(serializeFileHeader(createFileHeader({ major: 5, minor: 0, build: 3, revision: 0 })).length).toBe(256)
  })

  it('시그니처 뒤에 NUL 패딩을 기록한다', () => {
    const raw = serializeFileHeader(createFileHeader({ major: 5, minor: 0, build: 0, revision: 0 }))
    expect(new TextDecoder('ascii').decode(raw.subarray(0, 17))).toBe('HWP Document File')
    expect([...raw.subarray(17, 32)].every((b) => b === 0)).toBe(true)
  })

  it('버전을 0xMMnnPPrr 형식의 리틀 엔디언으로 기록한다', () => {
    // 5.0.3.0은 0x05000300으로 묶이고 디스크에서는 00 03 00 05다.
    const raw = serializeFileHeader(createFileHeader({ major: 5, minor: 0, build: 3, revision: 0 }))
    expect([...raw.subarray(32, 36)]).toEqual([0x00, 0x03, 0x00, 0x05])
  })

  it('모든 속성 플래그를 직렬화한 뒤 다시 파싱한다', () => {
    const header = createFileHeader({ major: 5, minor: 1, build: 0, revision: 0 }, {
      compressed: false,
      distribution: true,
      hasScripts: true,
      trackChanges: true,
      kogl: true,
      hasTableOfContentsField: true,
    })
    const parsed = parseFileHeader(serializeFileHeader(header))
    expect(parsed.flags.compressed).toBe(false)
    expect(parsed.flags.distribution).toBe(true)
    expect(parsed.flags.hasScripts).toBe(true)
    expect(parsed.flags.trackChanges).toBe(true)
    expect(parsed.flags.kogl).toBe(true)
    expect(parsed.flags.hasTableOfContentsField).toBe(true)
    expect(parsed.flags.drm).toBe(false)
  })

  it('실제 파일처럼 시그니처 패딩이 0이 아니어도 허용한다', () => {
    const raw = serializeFileHeader(createFileHeader({ major: 5, minor: 0, build: 0, revision: 0 }))
    raw[20] = 0x41
    expect(() => parseFileHeader(raw)).not.toThrow()
  })

  it('HWP 5 헤더가 아닌 스트림을 거부한다', () => {
    expect(() => parseFileHeader(new Uint8Array(256))).toThrow(/HWP 5 문서가 아닙니다/)
    expect(() => parseFileHeader(new Uint8Array(10))).toThrow(/최소 256바이트여야 합니다/)
  })

  it('한글에서 표시하는 형식으로 버전을 표현한다', () => {
    expect(formatVersion({ major: 5, minor: 0, build: 3, revision: 0 })).toBe('5.0.3.0')
  })
})

describe('태그 정의', () => {
  it('모든 태그 값을 HWPTAG_BEGIN 기준으로 정의한다', () => {
    expect(HWPTAG_BEGIN).toBe(0x010)
    expect(DocInfoTag.DocumentProperties).toBe(0x010)
    expect(DocInfoTag.CharShape).toBe(0x015)
    expect(DocInfoTag.ParaShape).toBe(0x019)
    expect(SectionTag.ParaHeader).toBe(0x042)
    expect(SectionTag.ParaText).toBe(0x043)
  })

  it('순서를 혼동하기 쉬운 SHAPE_COMPONENT를 TABLE 앞에 둔다', () => {
    expect(SectionTag.ShapeComponent).toBe(0x04c)
    expect(SectionTag.Table).toBe(0x04d)
  })

  it('진단에 사용할 태그 이름을 반환한다', () => {
    expect(tagName(SectionTag.ParaText)).toBe('ParaText')
    expect(tagName(DocInfoTag.FaceName, 'docinfo')).toBe('FaceName')
    expect(tagName(0x3ff)).toMatch(/Unknown/)
  })
})
