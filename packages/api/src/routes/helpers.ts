import type { Context } from 'hono'
import { z } from 'zod'
import type { CallerContext } from '../middleware/auth'
import { type ResolveWriteOperatorId, operatorReadScope } from '../tenancy'

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

// --- Path param helpers ---

type ParseIdSuccess = { ok: true; id: string }
type ParseIdFailure = { ok: false; response: Response }

// Every entity `id` is a `crypto.randomUUID()` (schema.ts) stored in a `text`
// column, so a malformed value doesn't fail a DB cast — it silently matches no
// row and the handler can't tell "bad input" from "not found". Validate the
// shape at the boundary so a non-uuid path param returns a clean 400 instead of
// leaking into a service/query. `z.string().uuid()` mirrors users.ts:9.
const idSchema = z.string().uuid()

/**
 * Validate a UUID path param at the HTTP boundary. Reads `c.req.param(name)` and
 * returns the id on success, or a 400 `fail()` envelope to short-circuit:
 *
 *   const idResult = parseId(c)
 *   if (!idResult.ok) return idResult.response
 *   ... service.findById(ctx, idResult.id)
 *
 * `name` defaults to `'id'`; pass the actual param (`'vehicleId'`, `'bookingId'`)
 * for routes that name it differently. The error names the param so a caller can
 * tell which segment was malformed. Only for UUID ids — never for `slug`/`token`.
 */
export function parseId(c: Context, name = 'id'): ParseIdSuccess | ParseIdFailure {
  const result = idSchema.safeParse(c.req.param(name))
  if (!result.success) {
    return { ok: false, response: fail(c, `${name} must be a valid uuid`, 400) }
  }
  return { ok: true, id: result.data }
}

// --- Body parsing helpers ---

type ParseBodySuccess<T> = { ok: true; data: T }
type ParseBodyFailure = { ok: false; response: Response }

export async function parseBody<T>(
  c: Context,
  schema: z.ZodType<T>,
  opts?: { allowEmpty?: boolean },
): Promise<ParseBodySuccess<T> | ParseBodyFailure> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch (err) {
    // A missing or non-JSON body is only tolerated when the caller opts in
    // (an endpoint whose whole payload is optional); otherwise propagate.
    if (!opts?.allowEmpty) throw err
    body = undefined
  }
  // With allowEmpty, an absent body or literal JSON `null` parses as `{}`, so a
  // schema of all-optional fields yields its defaults instead of a 400.
  if (opts?.allowEmpty && (body === undefined || body === null)) {
    body = {}
  }

  const result = schema.safeParse(body)

  if (!result.success) {
    return {
      ok: false,
      response: fail(c, result.error.flatten().fieldErrors as Record<string, unknown>, 400),
    }
  }

  return { ok: true, data: result.data }
}

type ScopedCreateSuccess<T> = { ok: true; data: T; operatorId: string }
type ScopedCreateResult<T> = ScopedCreateSuccess<T> | ParseBodyFailure

/**
 * Parse + authorize a create on an operator-owned config resource (fee-schedules,
 * insurance-options, add-ons, locations — audit L4). All four shared an identical
 * ~10-line branch: a bypass caller (PLATFORM_ADMIN / legacy staff — `all` read
 * scope) names the target operator in the body and is parsed with the
 * platform-admin schema; an operator caller never sends one, so its tenant is
 * stamped server-side via `resolveWriteOperatorId(ctx)`. Collapsing it here keeps
 * the "who can write to which tenant" policy in one place — a new write route
 * can't silently drift from it, and a bypass caller can never spoof another
 * operator (operator callers' body `operatorId`, if any, is ignored).
 *
 * Returns the parsed `data` (narrowed to the operator schema's `T`) plus the
 * resolved `operatorId`, or a 400 `response` to short-circuit on a bad body.
 */
export async function parseScopedCreate<T>(
  c: Context,
  ctx: CallerContext,
  schemas: { operator: z.ZodType<T>; admin: z.ZodType<T & { operatorId?: string | undefined }> },
  resolveWriteOperatorId: ResolveWriteOperatorId,
): Promise<ScopedCreateResult<T>> {
  if (operatorReadScope(ctx).kind === 'all') {
    const parsed = await parseBody(c, schemas.admin)
    if (!parsed.ok) return parsed
    return {
      ok: true,
      data: parsed.data,
      operatorId: await resolveWriteOperatorId(ctx, parsed.data.operatorId),
    }
  }
  const parsed = await parseBody(c, schemas.operator)
  if (!parsed.ok) return parsed
  return { ok: true, data: parsed.data, operatorId: await resolveWriteOperatorId(ctx) }
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

  // Both-absent returned above, so at least one is present here; require both.
  // This local guard narrows fromParam/toParam to string via control flow, so
  // the date parsing below needs no non-null assertions (#732).
  if (!fromParam || !toParam) {
    return {
      ok: false,
      response: fail(c, 'Both "from" and "to" are required for date range filtering', 400),
    }
  }

  const from = new Date(fromParam)
  const to = new Date(toParam)

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
