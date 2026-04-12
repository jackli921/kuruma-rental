import type { Context } from 'hono'
import type { z } from 'zod'

// --- Response helpers ---

export function ok<T>(c: Context, data: T, status = 200): Response {
  return c.json({ success: true, data }, status as 200)
}

export function fail(
  c: Context,
  error: string | Record<string, unknown>,
  status: number,
  extras?: Record<string, unknown>,
): Response {
  return c.json({ success: false, error, ...extras }, status as 400)
}

// --- Request parsing helpers ---

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
