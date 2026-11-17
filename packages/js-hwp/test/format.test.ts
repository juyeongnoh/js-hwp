import { describe, expect, it } from 'vitest'
import {
  DocumentBuilder,
  UnsupportedFormatError,
  detectFormat,
  documentText,
  open,
  save,
} from '../src/index.js'

const doc = () => new DocumentBuilder().meta({ title: '문서' }).paragraph('안녕하세요').build()

describe('detectFormat', () => {
  it('identifies hwp from its bytes', () => {
    expect(detectFormat(save(doc()))).toBe('hwp')
  })

  it('returns undefined for anything else', () => {
    expect(detectFormat(new Uint8Array([1, 2, 3, 4]))).toBeUndefined()
  })
})

describe('open', () => {
  it('round trips without being told the format', () => {
    expect(documentText(open(save(doc())))).toBe('안녕하세요')
  })

  it('can be forced to a format', () => {
    expect(documentText(open(save(doc(), 'hwp'), { format: 'hwp' }))).toBe('안녕하세요')
  })

  it('explains what an unrecognised file actually is', () => {
    expect(() => open(new TextEncoder().encode('%PDF-1.7\n'))).toThrow(/PDF/)
    expect(() => open(new TextEncoder().encode('HWP Document File V3.00'))).toThrow(/HWP 3\.x/)
    expect(() => open(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]))).toThrow(/ZIP archive/)
    expect(() => open(new Uint8Array([1, 2, 3]))).toThrow(UnsupportedFormatError)
  })
})
