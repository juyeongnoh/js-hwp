/**
 * `.hwp` 파일 전체를 읽고 쓴다.
 *
 * 계층들을 잇는다. CFB 컨테이너, `FileHeader`, 스트림 압축, `DocInfo`, 그리고
 * 각 `BodyText/Section{N}`.
 */

import { type HwpDocument, createDocument } from '@js-hwp/core'
import { ObjectType, foldName, lookup, read as readCfb, write as writeCfb } from '@js-hwp/cfb'
import { HwpFormatError } from './bytes.js'
import { maybeDeflate, maybeInflate } from './compress.js'
import { parseDocInfo, serializeDocInfo } from './docinfo.js'
import { parseSection, serializeSection } from './bodytext.js'
import {
  type FileHeader,
  SIGNATURE,
  createFileHeader,
  parseFileHeader,
  serializeFileHeader,
} from './fileheader.js'

export interface ParseHwpOptions {
  /** 임베드된 바이너리를 메모리에 유지한다. 기본값 `true`. */
  loadBinData?: boolean
  /**
   * 이 라이브러리가 복호화할 수 없는 배포용 문서나 암호 보호 파일이면 예외를
   * 던진다. 기본값 `true`.
   */
  strict?: boolean
}

export interface SerializeHwpOptions {
  /** 레코드 스트림을 압축한다. 한글이 하는 대로 기본값 `true`. */
  compress?: boolean
  /** `PrvText` 미리보기 스트림을 포함한다. 기본값 `true`. */
  preview?: boolean
}

/**
 * 복합 파일 이름은 대소문자를 무시하고 비교되고(MS-CFB §2.6.4) 서드파티
 * 라이터들이 그걸 이용한다. 실제 문서에 `Bindata`, `Prvtext`, `bodytext`가
 * 모두 나온다. 정확히 대조하면 그런 파일을 빈 것으로 읽으므로, 아래 모든 스트림
 * 이름을 접어서 대조한다. 그리고 같은 헬퍼 둘이 무엇을 불러올지와 무엇을 손대지
 * 않고 통과시킬지를 함께 정하므로, 둘이 어긋나서 한 스트림을 두 표기로 두 번
 * 쓰는 일이 생길 수 없다.
 */
const isStream = (path: string, name: string): boolean => foldName(path) === foldName(name)
const isUnder = (path: string, storage: string): boolean =>
  foldName(path).startsWith(`${foldName(storage)}/`)

/** 이것이 HWP 5.x 바이너리 문서인가? */
export function isHwp(data: Uint8Array): boolean {
  // FileHeader 스트림이 HWP 시그니처를 담고 있는 복합 파일.
  if (data.length < 8) return false
  const cfbSignature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  for (let i = 0; i < 8; i++) {
    if (data[i] !== cfbSignature[i]) return false
  }
  try {
    const container = readCfb(data)
    const header = lookup(container, 'FileHeader')
    if (!header || header.content.length < SIGNATURE.length) return false
    return new TextDecoder('ascii').decode(header.content.subarray(0, SIGNATURE.length)) === SIGNATURE
  } catch {
    return false
  }
}

/** HWP 5.x 바이너리 문서를 파싱한다. */
export function parseHwp(data: Uint8Array, options: ParseHwpOptions = {}): HwpDocument {
  const container = readCfb(data)

  const headerStream = lookup(container, 'FileHeader')?.content
  if (!headerStream) throw new HwpFormatError('Compound file has no FileHeader stream')
  const fileHeader = parseFileHeader(headerStream)

  if (options.strict !== false) {
    if (fileHeader.flags.passwordProtected) {
      throw new HwpFormatError(
        'This document is password protected. Decryption is not supported; ' +
          'open it in Hangul and save an unprotected copy.',
      )
    }
    if (fileHeader.flags.distribution) {
      throw new HwpFormatError(
        'This is a distribution document (배포용 문서). Its body is encrypted in ' +
          'ViewText streams, which this library does not decrypt.',
      )
    }
  }

  const compressed = fileHeader.flags.compressed
  const doc = createDocument({
    version: fileHeader.version,
    fonts: [],
    charShapes: [],
    paraShapes: [],
    borderFills: [],
    styles: [],
    numberings: [],
    bullets: [],
    tabDefs: [],
    binData: [],
    sections: [],
  })

  const docInfo = lookup(container, 'DocInfo')?.content
  if (!docInfo) throw new HwpFormatError('Compound file has no DocInfo stream')
  parseDocInfo(doc, maybeInflate(docInfo, compressed))

  if (options.loadBinData !== false) {
    for (const entry of container.entries) {
      if (!isUnder(entry.path, 'BinData') || entry.type !== ObjectType.Stream) continue
      const name = entry.path.slice('BinData/'.length)
      const dot = name.lastIndexOf('.')
      const id = dot === -1 ? name : name.slice(0, dot)
      // `DocInfo`는 id를 `BIN%04X`로 적는다. `bin0001.png`라는 이름의 스트림도
      // 같은 항목을 가리키므로 컨테이너가 하는 방식대로 대조한다.
      const existing = doc.binData.find((item) => foldName(item.id ?? '') === foldName(id))
      // BinData 스트림은 레코드 스트림과 독립적으로 압축된다.
      const bytes = safeInflate(entry.content, existing?.compressed ?? compressed)
      if (existing) existing.data = bytes
      else {
        doc.binData.push({
          kind: 0,
          extension: dot === -1 ? 'bin' : name.slice(dot + 1),
          data: bytes,
          id,
        })
      }
    }
  }

  const sectionPaths = container.entries
    .filter((entry) => /^BodyText\/Section\d+$/i.test(entry.path))
    .sort((a, b) => sectionNumber(a.path) - sectionNumber(b.path))

  for (const entry of sectionPaths) {
    doc.sections.push(parseSection(doc, maybeInflate(entry.content, compressed)))
  }

  if (doc.sections.length === 0) {
    doc.sections.push({ pageDef: createDocument().sections[0]!.pageDef, paragraphs: [] })
  }
  for (const section of doc.sections) {
    if (section.paragraphs.length === 0) {
      section.paragraphs.push({ paraShapeId: 0, styleId: 0, runs: [{ charShapeId: 0, items: [] }] })
    }
  }

  const preview = lookup(container, 'PrvText')?.content
  if (preview) doc.preview = decodeUtf16(preview)

  // 모델링하지 않는 스트림을 보관해서 읽고-고치고-쓰는 주기가 보존하게 한다.
  doc.preserved ??= {}
  doc.preserved.streams = {}
  for (const entry of container.entries) {
    if (entry.type !== ObjectType.Stream) continue
    if (
      isStream(entry.path, 'FileHeader') ||
      isStream(entry.path, 'DocInfo') ||
      isStream(entry.path, 'PrvText') ||
      isUnder(entry.path, 'BodyText') ||
      isUnder(entry.path, 'BinData')
    ) {
      continue
    }
    doc.preserved.streams[entry.path] = entry.content
  }

  return doc
}

/** 문서를 HWP 5.x 바이너리 파일로 직렬화한다. */
export function serializeHwp(doc: HwpDocument, options: SerializeHwpOptions = {}): Uint8Array {
  const compress = options.compress !== false

  const fileHeader: FileHeader = createFileHeader(doc.version, { compressed: compress })
  const streams: Record<string, Uint8Array> = {
    FileHeader: serializeFileHeader(fileHeader),
    DocInfo: maybeDeflate(serializeDocInfo(doc), compress),
  }

  doc.sections.forEach((section, index) => {
    streams[`BodyText/Section${index}`] = maybeDeflate(
      serializeSection(doc, section, true),
      compress,
    )
  })

  doc.binData.forEach((item, index) => {
    if (!item.data) return
    streams[`BinData/${binDataStreamName(index, item.extension)}`] = maybeDeflate(item.data, compress)
  })

  if (options.preview !== false) {
    streams.PrvText = encodeUtf16(doc.preview ?? '')
  }

  for (const [path, bytes] of Object.entries(doc.preserved?.streams ?? {})) {
    streams[path] ??= bytes
  }

  return writeCfb({ streams })
}

const sectionNumber = (path: string): number => Number(/(\d+)$/.exec(path)?.[1] ?? 0)

/** HWP는 임베드된 바이너리를 1부터 시작하는 `BIN%04X.ext`로 이름 짓는다. */
export const binDataStreamName = (index: number, extension: string): string =>
  `BIN${(index + 1).toString(16).toUpperCase().padStart(4, '0')}.${extension}`

function safeInflate(data: Uint8Array, compressed: boolean): Uint8Array {
  if (!compressed) return data
  try {
    return maybeInflate(data, true)
  } catch {
    // 일부 라이터가 항목별 압축 플래그를 잘못 설정한다. 저장된 것으로 취급한다.
    return data
  }
}

function decodeUtf16(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let out = ''
  for (let i = 0; i + 1 < bytes.byteLength; i += 2) out += String.fromCharCode(view.getUint16(i, true))
  return out
}

function encodeUtf16(value: string): Uint8Array {
  const out = new Uint8Array(value.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), true)
  return out
}
