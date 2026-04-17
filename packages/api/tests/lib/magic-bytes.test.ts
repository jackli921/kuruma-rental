import { describe, expect, it } from 'vitest'
import { detectImageType } from '../../src/lib/magic-bytes'

function bytesOf(...hex: string[]): Uint8Array {
  return new Uint8Array(hex.map((h) => Number.parseInt(h, 16)))
}

describe('detectImageType', () => {
  it('detects JPEG from FF D8 FF magic', () => {
    expect(detectImageType(bytesOf('FF', 'D8', 'FF', 'E0', '00', '10'))).toBe('jpeg')
  })

  it('detects PNG from 89 50 4E 47 0D 0A 1A 0A magic', () => {
    expect(detectImageType(bytesOf('89', '50', '4E', '47', '0D', '0A', '1A', '0A'))).toBe('png')
  })

  it('detects WebP from RIFF....WEBP magic', () => {
    // "RIFF" + 4-byte size + "WEBP"
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ])
    expect(detectImageType(bytes)).toBe('webp')
  })

  it('detects AVIF from ftypavif brand', () => {
    // 4-byte box size + "ftyp" + "avif"
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
    ])
    expect(detectImageType(bytes)).toBe('avif')
  })

  it('detects AVIF from ftypavis brand', () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x73,
    ])
    expect(detectImageType(bytes)).toBe('avif')
  })

  it('returns null for HTML bytes', () => {
    const bytes = new TextEncoder().encode('<html><script>alert(1)</script>')
    expect(detectImageType(bytes)).toBeNull()
  })

  it('returns null for SVG bytes (not an image bitmap)', () => {
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">')
    expect(detectImageType(bytes)).toBeNull()
  })

  it('returns null for empty buffer', () => {
    expect(detectImageType(new Uint8Array([]))).toBeNull()
  })

  it('returns null for RIFF without WEBP marker', () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]) // RIFF....WAVE (audio)
    expect(detectImageType(bytes)).toBeNull()
  })

  it('returns null for ftyp without avif/avis brand', () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
    ]) // ftypmp42 (MP4 video)
    expect(detectImageType(bytes)).toBeNull()
  })

  it('returns null for truncated JPEG (only FF D8)', () => {
    expect(detectImageType(bytesOf('FF', 'D8'))).toBeNull()
  })
})
