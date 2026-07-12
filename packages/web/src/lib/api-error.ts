import type { ErrorCode } from '@kuruma/shared/lib/error-codes'
import type { ApiResponse } from '@kuruma/shared/types/api-response'
import type { z } from 'zod'

/**
 * Error thrown by {@link unwrap} when the API returns a non-success body.
 * Carries the HTTP `status` so the server-action boundary can map specific
 * failures (e.g. a 422 operator-required) to a `code` instead of collapsing
 * everything to a bare message (#407 §3e).
 */
export class ApiError extends Error {
  readonly name = 'ApiError'
  readonly status: number
  /** Machine-readable failure code from the envelope (`fail(c, …, { code })`),
   *  when present. Lets callers distinguish same-status failures (e.g. a
   *  document-gate 403 vs a plain authorization deny) without parsing messages. */
  readonly code: ErrorCode | undefined

  constructor(message: string, status: number, code?: ErrorCode) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * Error thrown by {@link unwrap} when a *success* response's `data` fails the
 * caller-supplied Zod schema — i.e. the API/web contract drifted (a renamed or
 * missing field). Without a schema such drift returns `undefined` deep in
 * render; validating at the seam turns it into a clean failure here (#711).
 * Carries the HTTP `status` (the response itself was 2xx) and the Zod `issues`.
 */
export class ParseError extends Error {
  readonly name = 'ParseError'
  readonly status: number
  readonly issues: z.ZodError['issues']

  constructor(message: string, status: number, issues: z.ZodError['issues']) {
    super(message)
    this.status = status
    this.issues = issues
  }
}

/**
 * Shared response unwrapper for the web-side API clients. On a success body
 * returns `data`; on a failure body throws an {@link ApiError} carrying the
 * status. Replaces the per-module copies that discarded the status.
 *
 * Pass a Zod `schema` to validate `data` at the network seam instead of trusting
 * the phantom `T` cast — drift then throws a {@link ParseError} rather than
 * surfacing as `undefined` in render (#711). Omitting it preserves the legacy
 * passthrough for clients not yet migrated.
 */
export async function unwrap<T>(res: Response, schema?: z.ZodType<T>): Promise<T> {
  // The envelope shape (`{ success, data | error }`) is trusted by construction:
  // every API route emits it through the shared `ok()`/`fail()` helpers, so we
  // cast it rather than validate it. The optional Zod `schema` below validates
  // `data` — the part that actually carries the API/web contract (#711).
  const body = (await res.json().catch(() => ({
    success: false as const,
    error: `Non-JSON response (HTTP ${res.status})`,
  }))) as ApiResponse<T>

  if (!body.success) {
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body.code)
  }

  if (!schema) return body.data

  const parsed = schema.safeParse(body.data)
  if (!parsed.success) {
    throw new ParseError(
      `API response body failed validation (HTTP ${res.status})`,
      res.status,
      parsed.error.issues,
    )
  }
  return parsed.data
}

/** A single page of a cursor-paginated read: the validated `data` plus the
 *  `nextCursor` to follow (`null` on the last page). */
export interface Page<T> {
  data: T
  nextCursor: string | null
}

/**
 * Like {@link unwrap}, but also surfaces the `nextCursor` the list routes attach
 * to the success envelope (`ok(c, data, 200, { nextCursor })`). `unwrap`
 * deliberately drops it; callers that must read a *whole* result set (not just
 * the first page) follow the cursor until it is null. The schema is required —
 * paginated reads always validate `data` at the seam.
 */
export async function unwrapPage<T>(res: Response, schema: z.ZodType<T>): Promise<Page<T>> {
  const body = (await res.json().catch(() => ({
    success: false as const,
    error: `Non-JSON response (HTTP ${res.status})`,
  }))) as ApiResponse<T> & { nextCursor?: unknown }

  if (!body.success) {
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body.code)
  }

  const parsed = schema.safeParse(body.data)
  if (!parsed.success) {
    throw new ParseError(
      `API response body failed validation (HTTP ${res.status})`,
      res.status,
      parsed.error.issues,
    )
  }
  // The cursor is meta, trusted-by-construction like the envelope; coerce a
  // missing/non-string value (last page) to a definite null.
  const nextCursor = typeof body.nextCursor === 'string' ? body.nextCursor : null
  return { data: parsed.data, nextCursor }
}

export const OPERATOR_REQUIRED: ErrorCode = 'OPERATOR_REQUIRED'

/** #877 Slice B: the booking-create 422 envelope codes when the operator has
 *  published rental terms. REQUIRED — the renter sent no acceptance; CHANGED —
 *  the pinned version is stale (the operator republished mid-checkout). PaymentStep
 *  keys the terms-modal re-present on these codes, not the bare 422 status. */
export const OPERATOR_TERMS_REQUIRED: ErrorCode = 'OPERATOR_TERMS_REQUIRED'
export const OPERATOR_TERMS_CHANGED: ErrorCode = 'OPERATOR_TERMS_CHANGED'

/** Envelope `code` the booking API returns when the #459 document-verification
 *  gate blocks a booking. Matches `documentVerificationGate` on the API side. */
export const DOCUMENT_VERIFICATION_REQUIRED: ErrorCode = 'DOCUMENT_VERIFICATION_REQUIRED'

/**
 * Recognises the write-path "operator must be named" rejection (a vehicle/class
 * create from `OperatorRequiredError`) by its self-describing envelope `code`,
 * so the UI can refetch operators and reveal the picker. Reads `error.code`
 * rather than regex-matching the message — copy or i18n changes can't break it
 * (#934). Matches the `OPERATOR_REQUIRED` code emitted by the API error handler.
 */
export function operatorRequiredCode(e: unknown): ErrorCode | undefined {
  return e instanceof ApiError && e.code === OPERATOR_REQUIRED ? OPERATOR_REQUIRED : undefined
}
