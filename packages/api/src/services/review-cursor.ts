import type { ReviewListCursor } from '../repositories/types'

/**
 * Opaque base64 keyset cursor for the public review list (#1449). Mirrors the search
 * surfaces' cursor idiom (services/search-paging.ts): btoa/atob are Web-standard on CF
 * Workers + Bun, and a malformed token decodes to `undefined` so the route answers 400
 * instead of letting atob() throw a 500 on a public endpoint.
 *
 * Payload is `${publishedAt ISO}${SEP}${id}` — pure ASCII, so btoa is safe; ISO timestamps
 * and uuids never contain the separator, so a first-`SEP` split is unambiguous.
 */
const SEP = '|'

export function encodeReviewCursor(cursor: ReviewListCursor): string {
  return btoa(`${cursor.publishedAt.toISOString()}${SEP}${cursor.id}`)
}

export function decodeReviewCursor(raw: string): ReviewListCursor | undefined {
  let decoded: string
  try {
    decoded = atob(raw)
  } catch {
    return undefined
  }
  const sep = decoded.indexOf(SEP)
  if (sep === -1) return undefined
  const id = decoded.slice(sep + 1)
  const publishedAt = new Date(decoded.slice(0, sep))
  if (id === '' || Number.isNaN(publishedAt.getTime())) return undefined
  return { publishedAt, id }
}
