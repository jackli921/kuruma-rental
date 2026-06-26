// Shared paging scaffold for the two public search services (flat per-car and
// grouped storefront-card). Both gather the same available-inventory slice and
// page it with an opaque base64 cursor; only the projection differs. Keeping the
// limit clamp and cursor codec here means a paging/cursor change lives in exactly
// one place and both search paths react to it. (#1113, audit L1)

export const DEFAULT_LIMIT = 25
export const MAX_LIMIT = 50

export function clampLimit(limit: number | undefined): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT
  return Math.min(limit, MAX_LIMIT)
}

// Opaque base64 cursor over a caller-derived string key. btoa/atob are Web-standard
// globals on CF Workers and Bun. The key derivation stays in each service (flat:
// itemKey(item); storefront: locationId) — only the codec is shared here.
export const encodeCursor = (key: string): string => btoa(key)

// Returns undefined for a malformed (non-base64) cursor so the caller can answer
// 400 instead of letting atob() throw into a 500 on a public endpoint.
export const decodeCursor = (cursor: string): string | undefined => {
  try {
    return atob(cursor)
  } catch {
    return undefined
  }
}
