import { describe, expect, it } from 'vitest'
import {
  R2_REF_PREFIX,
  encodeR2Ref,
  isForeignVehiclePhoto,
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

// #967: cross-tenant photo-spoof guard. An operator can submit any string that
// passes `z.string().url()` in a `photos` array; the repo re-encodes one of OUR
// public URLs back to `r2:<key>` on write. Submitting `${BASE}/vehicles/<victim>
// /x.jpg` would therefore mint `r2:vehicles/<victim>/…` on the attacker's own
// row, and a renter read would render the victim's photo as theirs. This pure
// predicate is the Functional Core the VehicleService shell rejects on.
describe('isForeignVehiclePhoto', () => {
  const OWNER = 'veh_123' // R2_KEY lives under vehicles/veh_123/
  const OWN_PHOTO = `${BASE}/${R2_KEY}` // ${BASE}/vehicles/veh_123/8f3a-9c.jpg
  const VICTIM_PHOTO = `${BASE}/vehicles/veh_999/secret.jpg`

  it('passes an external image URL — never one of ours, any owner', () => {
    expect(isForeignVehiclePhoto(EXTERNAL, OWNER, BASE)).toBe(false)
    expect(isForeignVehiclePhoto(EXTERNAL, null, BASE)).toBe(false)
  })

  it('passes a bare relative value — already a key, not a foreign URL', () => {
    expect(isForeignVehiclePhoto(R2_KEY, OWNER, BASE)).toBe(false)
  })

  it('rejects ANY of-our-origin URL on create (no owning vehicle exists yet)', () => {
    expect(isForeignVehiclePhoto(OWN_PHOTO, null, BASE)).toBe(true)
    expect(isForeignVehiclePhoto(VICTIM_PHOTO, null, BASE)).toBe(true)
  })

  it("passes the vehicle's OWN of-our-origin photo on update", () => {
    expect(isForeignVehiclePhoto(OWN_PHOTO, OWNER, BASE)).toBe(false)
  })

  it("rejects another vehicle's of-our-origin photo on update", () => {
    expect(isForeignVehiclePhoto(VICTIM_PHOTO, OWNER, BASE)).toBe(true)
  })

  it('is inert when the base is empty (dev/test — no public bucket configured)', () => {
    expect(isForeignVehiclePhoto(VICTIM_PHOTO, OWNER, '')).toBe(false)
  })
})
