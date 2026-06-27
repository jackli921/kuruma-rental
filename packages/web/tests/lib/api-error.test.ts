import {
  ApiError,
  OPERATOR_REQUIRED,
  ParseError,
  operatorRequiredCode,
  unwrap,
  unwrapPage,
} from '@/lib/api-error'
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

  it('carries the failure body `code` so callers can discriminate failures', async () => {
    // The document-gate 403 and an operator-scope 403 share a status; only the
    // machine-readable `code` distinguishes "upload documents" from a plain deny.
    const res = jsonResponse(
      {
        success: false,
        error: 'An approved International Driving Permit is required to book.',
        code: 'DOCUMENT_VERIFICATION_REQUIRED',
      },
      403,
    )
    const err = (await unwrap(res).catch((e) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(403)
    expect(err.code).toBe('DOCUMENT_VERIFICATION_REQUIRED')
  })

  it('leaves `code` undefined when the failure body carries none', async () => {
    const err = (await unwrap(jsonResponse({ success: false, error: 'nope' }, 403)).catch(
      (e) => e,
    )) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBeUndefined()
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
    expect(err.message).toContain('HTTP 200')
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

describe('unwrapPage', () => {
  const rowsSchema = z.array(z.object({ id: z.string() }))

  it('returns the parsed data and the envelope nextCursor', async () => {
    const res = jsonResponse(
      { success: true, data: [{ id: 'a' }, { id: 'b' }], nextCursor: 'eyJrIjoiYiJ9' },
      200,
    )
    await expect(unwrapPage(res, rowsSchema)).resolves.toEqual({
      data: [{ id: 'a' }, { id: 'b' }],
      nextCursor: 'eyJrIjoiYiJ9',
    })
  })

  it('reports nextCursor as null on the last page (no cursor in the envelope)', async () => {
    const res = jsonResponse({ success: true, data: [{ id: 'a' }] }, 200)
    const page = await unwrapPage(res, rowsSchema)
    expect(page.nextCursor).toBeNull()
  })

  it('throws a ParseError when the page data drifts from the schema', async () => {
    const res = jsonResponse({ success: true, data: [{ code: 'a' }], nextCursor: null }, 200)
    await expect(unwrapPage(res, rowsSchema)).rejects.toBeInstanceOf(ParseError)
  })

  it('throws an ApiError on a failure envelope', async () => {
    const res = jsonResponse({ success: false, error: 'boom' }, 500)
    await expect(unwrapPage(res, rowsSchema)).rejects.toMatchObject({ status: 500 })
  })
})

describe('operatorRequiredCode', () => {
  it('returns OPERATOR_REQUIRED off the envelope code, regardless of message (#934)', () => {
    // Code-driven, not message-driven: a reworded or localized message must not
    // change the result, now that the API emits a self-describing `code`.
    const err = new ApiError('Choose a target operator', 422, OPERATOR_REQUIRED)
    expect(operatorRequiredCode(err)).toBe(OPERATOR_REQUIRED)
  })

  it('returns undefined when the message names operatorId but carries no code', () => {
    // The legacy message-regex bridge is retired — only the envelope code counts.
    expect(operatorRequiredCode(new ApiError('operatorId is required', 422))).toBeUndefined()
  })

  it('returns undefined for a different code and for non-ApiError values', () => {
    expect(operatorRequiredCode(new ApiError('nope', 422, 'SOMETHING_ELSE'))).toBeUndefined()
    expect(operatorRequiredCode(new Error('operatorId is required'))).toBeUndefined()
    expect(operatorRequiredCode(null)).toBeUndefined()
  })
})
