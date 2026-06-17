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
