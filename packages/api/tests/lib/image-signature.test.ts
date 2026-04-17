import { describe, expect, it } from 'vitest'
import { detectImageType } from '../../src/lib/image-signature'

const JPEG_SOI = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const WEBP_HEADER = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
])
const AVIF_HEADER = new Uint8Array([
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0x00, 0x00,
])

describe('detectImageType', () => {
  it('returns image/jpeg for JPEG magic bytes', () => {
    expect(detectImageType(JPEG_SOI)).toBe('image/jpeg')
  })

  it('returns image/png for PNG magic bytes', () => {
    expect(detectImageType(PNG_HEADER)).toBe('image/png')
  })

  it('returns image/webp for RIFF...WEBP', () => {
    expect(detectImageType(WEBP_HEADER)).toBe('image/webp')
  })

  it('returns image/avif for ftypavif', () => {
    expect(detectImageType(AVIF_HEADER)).toBe('image/avif')
  })

  it('returns null for SVG content (XSS vector)', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">')
    expect(detectImageType(svg)).toBeNull()
  })

  it('returns null for HTML content spoofing as JPEG', () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><script>alert(1)</script>')
    expect(detectImageType(html)).toBeNull()
  })

  it('returns null for all-zeroes (what the test fixtures currently use)', () => {
    expect(detectImageType(new Uint8Array(32))).toBeNull()
  })

  it('returns null for too-short buffers', () => {
    expect(detectImageType(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })

  it('rejects heic/heix ftyp brands (not in allowlist)', () => {
    const heic = new Uint8Array([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ])
    expect(detectImageType(heic)).toBeNull()
  })
})
