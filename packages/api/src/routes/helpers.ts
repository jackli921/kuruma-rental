import type { Context } from 'hono'
import type { z } from 'zod'

// --- Response helpers ---

export function ok<T>(
  c: Context,
  data: T,
  status = 200,
  extras?: Record<string, unknown>,
): Response {
  return c.json({ success: true, data, ...extras }, status as 200)
}

export function fail(
  c: Context,
  error: string | Record<string, unknown>,
  status: number,
  extras?: Record<string, unknown>,
): Response {
  return c.json({ success: false, error, ...extras }, status as 400)
}

// --- Object helpers ---

/** Remove entries with `undefined` values. Isolates the single type assertion
 *  needed for exactOptionalPropertyTypes compliance so call sites stay clean. */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v
  }
  return result as Partial<T>
}

// --- Pagination helpers ---

type LimitOptions = { defaultLimit?: number; maxLimit?: number }
type LimitSuccess = { ok: true; limit: number }
type PaginationSuccess = { ok: true; limit: number; offset: number }
type ParseFailure = { ok: false; response: Response }

const MAX_OFFSET = 1_000_000

// Strict non-negative integer parse. Rejects "10abc", "1.5", "-1", "1e5",
// unlike Number.parseInt which silently accepts the prefix of malformed input.
function parseNonNegativeInt(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : undefined
}

/** Parse `limit` query param only. Use for cursor-based pagination where
 *  `offset` is not meaningful. Defaults: limit=25, max=100. */
export function parseLimit(c: Context, opts?: LimitOptions): LimitSuccess | ParseFailure {
  const maxLimit = opts?.maxLimit ?? 100
  const limitParam = c.req.query('limit')
  const limit =
    limitParam === undefined ? (opts?.defaultLimit ?? 25) : parseNonNegativeInt(limitParam)
  if (limit === undefined || limit < 1 || limit > maxLimit) {
    return { ok: false, response: fail(c, `limit must be between 1 and ${maxLimit}`, 400) }
  }
  return { ok: true, limit }
}

/** Parse `limit` and `offset` query params. Use for offset-based pagination.
 *  Defaults: limit=25, max=100, offset=0, maxOffset=1,000,000. */
export function parsePagination(c: Context, opts?: LimitOptions): PaginationSuccess | ParseFailure {
  const limitResult = parseLimit(c, opts)
  if (!limitResult.ok) return limitResult

  const offsetParam = c.req.query('offset')
  const offset = offsetParam === undefined ? 0 : parseNonNegativeInt(offsetParam)
  if (offset === undefined || offset > MAX_OFFSET) {
    return {
      ok: false,
      response: fail(c, `offset must be a non-negative integer (max ${MAX_OFFSET})`, 400),
    }
  }

  return { ok: true, limit: limitResult.limit, offset }
}

// --- Upload size guard ---

/**
 * Slack added to a route's payload budget to cover multipart framing (boundary
 * lines, Content-Disposition headers, extra form fields) so a legitimately
 * max-sized file isn't false-rejected by a few hundred bytes of envelope. The
 * service's exact per-file check enforces the real limit. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024

/**
 * Pure decision: does the `Content-Length` header declare a body strictly
 * larger than `maxBytes`? Returns false for an absent, empty, or malformed
 * header — we only reject on a value we can trust. The per-file size check in
 * the service is the precise backstop; this is the cheap early gate that lets
 * a route reject an abusive body before buffering it into memory.
 */
export function exceedsContentLength(header: string | null | undefined, maxBytes: number): boolean {
  if (!header) return false
  const declared = parseNonNegativeInt(header)
  return declared !== undefined && declared > maxBytes
}

/**
 * Reject an oversized multipart/body request early (413) based on its
 * `Content-Length`, before `parseBody()` buffers the bytes. Returns the 413
 * response to short-circuit, or `undefined` to continue. Call at the top of
 * an upload handler: `return rejectOversizedBody(c, MAX) ?? (await handle())`.
 */
export function rejectOversizedBody(c: Context, maxBytes: number): Response | undefined {
  if (exceedsContentLength(c.req.header('content-length'), maxBytes)) {
    return fail(c, 'Request body too large', 413)
  }
  return undefined
}

// --- Cache headers ---

/**
 * Mark this response as publicly cacheable at the edge for `maxAgeSeconds`.
 *
 * Uses `s-maxage` (shared-cache directive) so CF's edge caches the response
 * but browsers do not — a browser user who refreshes will hit our Worker
 * again. That's usually what we want: origin traffic drops dramatically
 * while owner edits still propagate to any given user within maxAgeSeconds.
 *
 * Call BEFORE `ok(c, data)`. Hono merges the header into the final response.
 *
 * Never call this on an error path — caching a 404 at the edge would pin
 * the missing resource until the TTL expires, blocking creation from taking
 * effect edge-wide.
 */
export function cachePublic(c: Context, maxAgeSeconds: number): void {
  c.header('Cache-Control', `public, s-maxage=${maxAgeSeconds}`)
}

// --- Body parsing helpers ---

type ParseBodySuccess<T> = { ok: true; data: T }
type ParseBodyFailure = { ok: false; response: Response }

export async function parseBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<ParseBodySuccess<T> | ParseBodyFailure> {
  const body = await c.req.json()
  const result = schema.safeParse(body)

  if (!result.success) {
    return {
      ok: false,
      response: fail(c, result.error.flatten().fieldErrors as Record<string, unknown>, 400),
    }
  }

  return { ok: true, data: result.data }
}

type DateRangeRequired = { ok: true; from: Date; to: Date }
type DateRangeOptional = { ok: true; from: Date | undefined; to: Date | undefined }
type DateRangeFailure = { ok: false; response: Response }

export function parseDateRange(c: Context, required: true): DateRangeRequired | DateRangeFailure
export function parseDateRange(c: Context, required: false): DateRangeOptional | DateRangeFailure
export function parseDateRange(
  c: Context,
  required: boolean,
): DateRangeRequired | DateRangeOptional | DateRangeFailure {
  const fromParam = c.req.query('from')
  const toParam = c.req.query('to')

  // Both absent
  if (!fromParam && !toParam) {
    if (required) {
      return {
        ok: false,
        response: fail(c, 'Both "from" and "to" query parameters are required', 400),
      }
    }
    return { ok: true, from: undefined, to: undefined }
  }

  // Only one provided
  if ((fromParam && !toParam) || (!fromParam && toParam)) {
    return {
      ok: false,
      response: fail(c, 'Both "from" and "to" are required for date range filtering', 400),
    }
  }

  const from = new Date(fromParam!)
  const to = new Date(toParam!)

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return {
      ok: false,
      response: fail(c, '"from" and "to" must be valid ISO dates', 400),
    }
  }

  if (to <= from) {
    return { ok: false, response: fail(c, '"to" must be after "from"', 400) }
  }

  return { ok: true, from, to }
}
