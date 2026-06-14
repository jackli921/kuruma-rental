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

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/**
 * Error a mutation hook throws when a server action returns `success: false`.
 * Carries the optional `code` from the {@link ActionResult} (e.g.
 * {@link OPERATOR_REQUIRED}) so React Query's `error` retains it and the dialog
 * can branch on it rather than only on the message string (#407 §3e).
 */
export class ActionError extends Error {
  readonly name = 'ActionError'
  // `string | undefined` (not optional `?`) so the assignment satisfies
  // exactOptionalPropertyTypes when the source ActionResult carries no code.
  readonly code: string | undefined

  constructor(message: string, code?: string) {
    super(message)
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
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status)
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

export const OPERATOR_REQUIRED = 'OPERATOR_REQUIRED'

/**
 * Recognises the write-path "operator must be named" rejection: a 422 whose
 * message names `operatorId` (the only 422 a vehicle/class create raises, from
 * `OperatorRequiredError`). Returns the {@link OPERATOR_REQUIRED} code so the
 * UI can refetch operators and reveal the picker, or `undefined` otherwise.
 */
export function operatorRequiredCode(e: unknown): string | undefined {
  return e instanceof ApiError && e.status === 422 && /operatorId is required/i.test(e.message)
    ? OPERATOR_REQUIRED
    : undefined
}
