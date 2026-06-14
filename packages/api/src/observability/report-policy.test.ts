import { describe, expect, it } from 'vitest'
import { SLOW_REQUEST_THRESHOLD_MS, classifyRequest } from './report-policy'

describe('classifyRequest', () => {
  it('reports a raw >=500 response as a server_error/error', () => {
    expect(classifyRequest({ status: 500, durationMs: 10, hadUnhandledError: false })).toEqual({
      report: true,
      reason: 'server_error',
      level: 'error',
    })
    expect(classifyRequest({ status: 503, durationMs: 10, hadUnhandledError: false })).toEqual({
      report: true,
      reason: 'server_error',
      level: 'error',
    })
  })

  it('does NOT double-report a 500 that came from a thrown error (onError already captured it)', () => {
    expect(classifyRequest({ status: 500, durationMs: 10, hadUnhandledError: true })).toEqual({
      report: false,
    })
  })

  it('reports a slow request (> threshold) as a slow_request/warning', () => {
    expect(classifyRequest({ status: 200, durationMs: 2001, hadUnhandledError: false })).toEqual({
      report: true,
      reason: 'slow_request',
      level: 'warning',
    })
  })

  it('does not report a request exactly at the threshold (strictly greater)', () => {
    expect(
      classifyRequest({
        status: 200,
        durationMs: SLOW_REQUEST_THRESHOLD_MS,
        hadUnhandledError: false,
      }),
    ).toEqual({ report: false })
  })

  it('does not report a fast 2xx/4xx response', () => {
    expect(classifyRequest({ status: 200, durationMs: 50, hadUnhandledError: false })).toEqual({
      report: false,
    })
    expect(classifyRequest({ status: 404, durationMs: 50, hadUnhandledError: false })).toEqual({
      report: false,
    })
  })

  it('prefers server_error over slow when a raw 500 is also slow', () => {
    expect(classifyRequest({ status: 500, durationMs: 9000, hadUnhandledError: false })).toEqual({
      report: true,
      reason: 'server_error',
      level: 'error',
    })
  })

  it('honours a custom slow threshold', () => {
    expect(
      classifyRequest({
        status: 200,
        durationMs: 600,
        hadUnhandledError: false,
        slowThresholdMs: 500,
      }),
    ).toEqual({ report: true, reason: 'slow_request', level: 'warning' })
  })
})
