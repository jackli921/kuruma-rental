/**
 * Photo source modeling (#879). A stored `photos` entry is one of two sources:
 * an R2-managed object (referenced by its bucket key) or an arbitrary external
 * image URL. Rather than a jsonb migration, the source is encoded into the
 * existing `text[]`: R2 objects as `r2:<key>`, external images as the full URL.
 *
 * These pure functions are the single codec for that encoding — the one
 * serialization boundary (#879 F3). Repositories decode stored entries to wire
 * URLs on read (so every read surface emits URLs, never raw keys); the upload
 * route encodes a freshly-stored key on write. No DB, no I/O — the decision is
 * pure; the thin shells that read/write live in the repos and the upload route
 * (Functional Core / Imperative Shell).
 *
 * Why the prefix is unambiguous: external images are validated as `z.string()
 * .url()`, so a stored URL always carries a scheme like `https:` and never
 * begins with the `r2:` sentinel. An R2 key (`vehicles/<id>/<uuid>.<ext>`) is
 * never a URL. The two forms cannot collide.
 */

/** Sentinel marking a stored entry as an R2 object key rather than a URL. */
export const R2_REF_PREFIX = 'r2:'

/** The resolved source of a stored photo entry. */
export type PhotoRef = { source: 'r2'; key: string } | { source: 'external'; url: string }

/** Encode a raw R2 object key into its stored (`r2:<key>`) form. */
export function encodeR2Ref(key: string): string {
  return `${R2_REF_PREFIX}${key}`
}

/** Resolve a stored `text[]` entry to its source. */
export function parsePhotoRef(stored: string): PhotoRef {
  if (stored.startsWith(R2_REF_PREFIX)) {
    return { source: 'r2', key: stored.slice(R2_REF_PREFIX.length) }
  }
  return { source: 'external', url: stored }
}

/**
 * Decode a stored entry to a wire URL. R2 refs expand to `${base}/${key}`
 * (mirroring `R2PhotoStorage.upload`); external URLs pass through unchanged.
 */
export function photoRefToWireUrl(stored: string, publicBaseUrl: string): string {
  const ref = parsePhotoRef(stored)
  return ref.source === 'r2' ? `${publicBaseUrl}/${ref.key}` : ref.url
}

/** Decode a stored `photos` array to wire URLs, preserving order. */
export function photoRefsToWireUrls(stored: readonly string[], publicBaseUrl: string): string[] {
  return stored.map((entry) => photoRefToWireUrl(entry, publicBaseUrl))
}

/**
 * Recover the R2 object key from one of our public wire URLs, or return the
 * input unchanged when it is not one of ours (a bare key, an external image, a
 * foreign origin). The inverse of {@link photoRefToWireUrl}'s `${base}/${key}`
 * expansion, and the primitive {@link R2PhotoStorage.delete} needs to address an
 * object in the bucket.
 *
 * Exact origin + base-path matching via URL parsing — NOT a loose string
 * prefix. A raw `startsWith(publicBaseUrl)` mis-handled a base with a trailing
 * slash (sliced one character into the key) and a look-alike host
 * (`https://cdn.example.com.evil/...` satisfies `startsWith` and got
 * mis-sliced). See #678 review.
 */
export function toObjectKey(keyOrUrl: string, publicBaseUrl: string): string {
  let target: URL
  try {
    target = new URL(keyOrUrl)
  } catch {
    return keyOrUrl // relative value — already a key
  }
  let base: URL
  try {
    base = new URL(publicBaseUrl)
  } catch {
    return keyOrUrl // base not a URL (e.g. empty in dev) — can't be our URL
  }
  if (target.origin !== base.origin) return keyOrUrl
  const basePath = base.pathname.replace(/\/+$/, '') // '' or '/sub'
  const prefix = `${basePath}/`
  if (!target.pathname.startsWith(prefix)) return keyOrUrl
  return target.pathname.slice(prefix.length)
}

/**
 * Encode a wire URL to its stored form (the write-side inverse of decode): one
 * of our public URLs becomes `r2:<key>`; anything else (an external image)
 * passes through unchanged. Repositories call this on write so an `r2:` ref is
 * minted in exactly one place and external URLs are never mistaken for ours —
 * a client cannot inject a key, since only a URL resolving to our own bucket
 * origin is ever re-encoded.
 */
export function wireUrlToStoredRef(wireUrl: string, publicBaseUrl: string): string {
  const key = toObjectKey(wireUrl, publicBaseUrl)
  // toObjectKey returns the input verbatim when it is not one of our URLs; a
  // matched URL is always strictly longer than its sliced key, so inequality
  // is a sound "this was ours" signal.
  return key === wireUrl ? wireUrl : encodeR2Ref(key)
}

/** Encode a wire-URL `photos` array to stored refs, preserving order. */
export function wireUrlsToStoredRefs(wireUrls: readonly string[], publicBaseUrl: string): string[] {
  return wireUrls.map((url) => wireUrlToStoredRef(url, publicBaseUrl))
}

/**
 * Cross-tenant photo-spoof guard (#967). True when `url` is one of OUR public
 * bucket URLs but addresses a vehicle other than `ownerVehicleId`.
 *
 * The attack: a stored `photos` entry that is one of our URLs is re-encoded to
 * `r2:<key>` by {@link wireUrlToStoredRef} on write, so an operator who submits
 * `${base}/vehicles/<victim>/x.jpg` would mint `r2:vehicles/<victim>/…` on their
 * OWN row — and a renter read ({@link photoRefToWireUrl}) then renders the
 * victim's photo as theirs. The repo encode is intentionally permissive (it
 * trusts validated input); this is the policy that decides ownership.
 *
 * - External image URLs (not our origin) and bare keys pass — `toObjectKey`
 *   returns them verbatim, so `key === url`.
 * - On create `ownerVehicleId` is null: no vehicle exists yet and uploads mint
 *   their own keys via `POST /vehicles/:id/photos`, so ANY of-our-origin URL in
 *   a create payload is foreign.
 * - On update only the vehicle's own `vehicles/<id>/…` prefix is permitted,
 *   mirroring {@link R2PhotoStorage.delete}'s own-prefix scoping.
 *
 * The raw `r2:` sentinel is blocked upstream by the photo schema's http(s)
 * refine, not here (an opaque `r2:` URL has no origin, so it can't match ours).
 * Pure (Functional Core); the VehicleService is the imperative shell.
 */
export function isForeignVehiclePhoto(
  url: string,
  ownerVehicleId: string | null,
  publicBaseUrl: string,
): boolean {
  const key = toObjectKey(url, publicBaseUrl)
  if (key === url) return false // not one of our URLs (external / bare key / dev with empty base)
  if (ownerVehicleId === null) return true // create: no owning vehicle to anchor against
  return !key.startsWith(`vehicles/${ownerVehicleId}/`)
}
