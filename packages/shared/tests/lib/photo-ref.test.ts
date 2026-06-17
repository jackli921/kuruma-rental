import { describe, expect, it } from 'vitest'
import {
  R2_REF_PREFIX,
  encodeR2Ref,
  parsePhotoRef,
  photoRefToWireUrl,
  photoRefsToWireUrls,
} from '../../src/lib/photo-ref'

// A real R2 object key shape: `vehicles/<vehicleId>/<uuid>.<ext>` (see
// r2-photo-storage.ts). Keys contain slashes, so the codec must not split on them.
const R2_KEY = 'vehicles/veh_123/8f3a-9c.jpg'
const BASE = 'https://photos.kuruma.app'
const EXTERNAL = 'https://images.unsplash.com/photo-1734857039653?w=800&q=80'

describe('R2_REF_PREFIX', () => {
  it('is the literal sentinel `r2:`', () => {
    expect(R2_REF_PREFIX).toBe('r2:')
  })
})

describe('encodeR2Ref', () => {
  it('prefixes a raw R2 key with the sentinel', () => {
    expect(encodeR2Ref(R2_KEY)).toBe(`r2:${R2_KEY}`)
  })
})

describe('parsePhotoRef', () => {
  it('classifies a sentinel-prefixed entry as an r2 ref, stripping the prefix', () => {
    expect(parsePhotoRef(`r2:${R2_KEY}`)).toEqual({ source: 'r2', key: R2_KEY })
  })

  it('classifies a plain URL as an external ref, preserving the url verbatim', () => {
    expect(parsePhotoRef(EXTERNAL)).toEqual({ source: 'external', url: EXTERNAL })
  })

  it('does not mistake an https URL containing a colon for an r2 ref', () => {
    expect(parsePhotoRef(BASE).source).toBe('external')
  })

  it('round-trips a key through encode → parse without loss', () => {
    const ref = parsePhotoRef(encodeR2Ref(R2_KEY))
    expect(ref).toEqual({ source: 'r2', key: R2_KEY })
  })
})

describe('photoRefToWireUrl', () => {
  it('expands an r2 ref to `${base}/${key}` (slashes in the key preserved)', () => {
    expect(photoRefToWireUrl(`r2:${R2_KEY}`, BASE)).toBe(`${BASE}/${R2_KEY}`)
  })

  it('passes an external URL through unchanged regardless of base', () => {
    expect(photoRefToWireUrl(EXTERNAL, BASE)).toBe(EXTERNAL)
  })
})

describe('photoRefsToWireUrls', () => {
  it('maps a mixed array, expanding r2 refs and passing externals through', () => {
    expect(photoRefsToWireUrls([`r2:${R2_KEY}`, EXTERNAL], BASE)).toEqual([
      `${BASE}/${R2_KEY}`,
      EXTERNAL,
    ])
  })

  it('returns an empty array unchanged', () => {
    expect(photoRefsToWireUrls([], BASE)).toEqual([])
  })
})
