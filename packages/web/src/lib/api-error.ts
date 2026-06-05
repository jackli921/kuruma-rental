import type { ApiResponse } from '@kuruma/shared/types/api-response'

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
 * Shared response unwrapper for the web-side API clients. On a success body
 * returns `data`; on a failure body throws an {@link ApiError} carrying the
 * status. Replaces the per-module copies that discarded the status.
 */
export async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({
    success: false as const,
    error: `Non-JSON response (HTTP ${res.status})`,
  }))) as ApiResponse<T>

  if (!body.success) {
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status)
  }

  return body.data
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
