// Magic-byte signatures for the image formats we accept. Trusting the
// multipart Content-Type is not sufficient — an attacker can set any header
// on arbitrary bytes. If R2 serves those bytes back with the declared
// contentType (it does), the public bucket URL becomes a stored-XSS vector.

export type DetectedImage = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'

export function detectImageType(bytes: Uint8Array): DetectedImage | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  // ISO base media: bytes 4..7 === 'ftyp', then a brand. AVIF brands:
  // avif, avis, mif1 (heif-compat), heic, heix — we accept avif/avis only.
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!)
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  return null
}
