export type ImageType = 'jpeg' | 'png' | 'webp' | 'avif'

/**
 * Sniff the image type from the first bytes of a file. Returns null if the
 * bytes don't match any allowed image format. Used to block content-type
 * spoofing — a client-declared `image/jpeg` header does not guarantee JPEG
 * bytes, so we must verify at the byte level before storing on R2.
 */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (isJpeg(bytes)) return 'jpeg'
  if (isPng(bytes)) return 'png'
  if (isWebp(bytes)) return 'webp'
  if (isAvif(bytes)) return 'avif'
  return null
}

function isJpeg(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
}

function isPng(b: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (b.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) {
    if (b[i] !== sig[i]) return false
  }
  return true
}

function isWebp(b: Uint8Array): boolean {
  // RIFF....WEBP — "RIFF" at 0-3, "WEBP" at 8-11
  if (b.length < 12) return false
  const riff = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
  const webp = b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  return riff && webp
}

function isAvif(b: Uint8Array): boolean {
  // ISO-BMFF: 4-byte box size, "ftyp" at 4-7, brand at 8-11
  if (b.length < 12) return false
  const ftyp = b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70
  if (!ftyp) return false
  // brand: "avif" or "avis"
  const brandIsAvi = b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69
  return brandIsAvi && (b[11] === 0x66 || b[11] === 0x73)
}
