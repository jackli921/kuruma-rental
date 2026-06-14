import { ApiError, ParseError, operatorRequiredCode, unwrap } from '@/lib/api-error'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('unwrap', () => {
  it('returns the data on a success response', async () => {
    const res = jsonResponse({ success: true, data: { id: 'v1' } }, 200)
    await expect(unwrap<{ id: string }>(res)).resolves.toEqual({ id: 'v1' })
  })

  it('throws an ApiError carrying the HTTP status on a failure response', async () => {
    const res = jsonResponse(
      { success: false, error: 'operatorId is required: specify a target operator' },
      422,
    )
    // #407 P2 (§3e): the status must survive so callers can map 422 -> picker.
    await expect(unwrap(res)).rejects.toMatchObject({
      status: 422,
      message: 'operatorId is required: specify a target operator',
    })
    await expect(unwrap(jsonResponse({ success: false, error: 'x' }, 500))).rejects.toBeInstanceOf(
      ApiError,
    )
  })

  it('throws an ApiError with the status when the body is not JSON', async () => {
    const res = new Response('<html>502</html>', { status: 502 })
    await expect(unwrap(res)).rejects.toMatchObject({ status: 502 })
  })
})

describe('unwrap with a Zod schema', () => {
  const vehicleSchema = z.object({ id: z.string(), seats: z.number() })

  it('returns the parsed data when body.data matches the schema', async () => {
    const res = jsonResponse({ success: true, data: { id: 'v1', seats: 5 } }, 200)
    await expect(unwrap(res, vehicleSchema)).resolves.toEqual({ id: 'v1', seats: 5 })
  })

  it('throws a ParseError at the seam when body.data drifts (renamed field)', async () => {
    // API renamed `seats` -> `seatCount`: the legacy cast returns an object whose
    // `seats` is undefined, surfacing deep in render. With a schema it fails here.
    const res = jsonResponse({ success: true, data: { id: 'v1', seatCount: 5 } }, 200)
    const err = (await unwrap(res, vehicleSchema).catch((e) => e)) as ParseError
    expect(err).toBeInstanceOf(ParseError)
    expect(err.status).toBe(200)
    expect(err.issues.some((issue) => issue.path.includes('seats'))).toBe(true)
  })

  it('does not consult the schema on a failure envelope (still throws ApiError)', async () => {
    const res = jsonResponse({ success: false, error: 'boom' }, 500)
    await expect(unwrap(res, vehicleSchema)).rejects.toBeInstanceOf(ApiError)
  })

  it('passes data through unchanged when no schema is supplied (back-compat)', async () => {
    const res = jsonResponse({ success: true, data: { anything: true } }, 200)
    await expect(unwrap(res)).resolves.toEqual({ anything: true })
  })
})

describe('operatorRequiredCode', () => {
  it('returns OPERATOR_REQUIRED for a 422 ApiError whose message names operatorId', () => {
    const err = new ApiError('operatorId is required: specify a target operator', 422)
    expect(operatorRequiredCode(err)).toBe('OPERATOR_REQUIRED')
  })

  it('returns undefined for a 422 with an unrelated message', () => {
    expect(operatorRequiredCode(new ApiError('seats must be positive', 422))).toBeUndefined()
  })

  it('returns undefined for a non-422 operatorId error and for non-ApiError values', () => {
    expect(operatorRequiredCode(new ApiError('operatorId is required', 400))).toBeUndefined()
    expect(operatorRequiredCode(new Error('operatorId is required'))).toBeUndefined()
    expect(operatorRequiredCode(null)).toBeUndefined()
  })
})
