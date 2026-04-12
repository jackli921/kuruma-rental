/**
 * Canonical API response shape used by all Hono routes and consumed
 * by all web-side fetchers. Discriminated union on `success`:
 *
 * - success=true  -> `data: T` is guaranteed
 * - success=false -> `error: string` is guaranteed
 *
 * Consumer migration tracked in the feature-modules PR-2/PR-3 plan.
 */
export type ApiResponse<T> =
  | { success: true; data: T }
  | {
      success: false
      error: string
      code?: string
      details?: Record<string, string[]>
    }
