import { describe, expect, it } from 'vitest'
import {
  R2_REF_PREFIX,
  encodeR2Ref,
  parsePhotoRef,
  photoRefToWireUrl,
  photoRefsToWireUrls,
  toObjectKey,
  wireUrlToStoredRef,
  wireUrlsToStoredRefs,
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

describe('toObjectKey', () => {
  it('recovers the object key from one of our public URLs (slashes preserved)', () => {
    expect(toObjectKey(`${BASE}/${R2_KEY}`, BASE)).toBe(R2_KEY)
  })

  it('returns a bare relative value unchanged — it is already a key', () => {
    expect(toObjectKey(R2_KEY, BASE)).toBe(R2_KEY)
  })

  it('ignores a trailing slash on the base instead of slicing into the key', () => {
    expect(toObjectKey(`${BASE}/${R2_KEY}`, `${BASE}/`)).toBe(R2_KEY)
  })

  it('does not strip a look-alike host that merely shares a string prefix', () => {
    const lookalike = `${BASE}.evil.com/vehicles/veh_123/x.jpg`
    expect(toObjectKey(lookalike, BASE)).toBe(lookalike)
  })

  it('returns a foreign-origin URL untouched', () => {
    expect(toObjectKey(EXTERNAL, BASE)).toBe(EXTERNAL)
  })

  it('returns the input when the base is not a URL (e.g. empty in dev)', () => {
    expect(toObjectKey(`${BASE}/${R2_KEY}`, '')).toBe(`${BASE}/${R2_KEY}`)
  })
})

describe('wireUrlToStoredRef', () => {
  it('encodes one of our public URLs to its r2 stored form', () => {
    expect(wireUrlToStoredRef(`${BASE}/${R2_KEY}`, BASE)).toBe(`r2:${R2_KEY}`)
  })

  it('passes an external URL through — clients can never mint an r2 ref', () => {
    expect(wireUrlToStoredRef(EXTERNAL, BASE)).toBe(EXTERNAL)
  })

  it('round-trips an r2 ref: decode to a wire URL then re-encode losslessly', () => {
    const wire = photoRefToWireUrl(`r2:${R2_KEY}`, BASE)
    expect(wireUrlToStoredRef(wire, BASE)).toBe(`r2:${R2_KEY}`)
  })
})

describe('wireUrlsToStoredRefs', () => {
  it('encodes a mixed array, r2-refing our URLs and passing externals through', () => {
    expect(wireUrlsToStoredRefs([`${BASE}/${R2_KEY}`, EXTERNAL], BASE)).toEqual([
      `r2:${R2_KEY}`,
      EXTERNAL,
    ])
  })

  it('returns an empty array unchanged', () => {
    expect(wireUrlsToStoredRefs([], BASE)).toEqual([])
  })
})
