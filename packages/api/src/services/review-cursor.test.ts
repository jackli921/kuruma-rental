import { describe, expect, it } from 'vitest'
import { decodeReviewCursor, encodeReviewCursor } from './review-cursor'

describe('review cursor codec (#1449)', () => {
  it('round-trips a (publishedAt, id) cursor', () => {
    const cursor = { publishedAt: new Date('2026-06-15T03:04:05.678Z'), id: 'abc-123' }
    const decoded = decodeReviewCursor(encodeReviewCursor(cursor))
    expect(decoded).toEqual(cursor)
  })

  it('emits an opaque token, not the plaintext id/date', () => {
    const token = encodeReviewCursor({
      publishedAt: new Date('2026-06-15T00:00:00.000Z'),
      id: 'u1',
    })
    expect(token).not.toContain('u1')
    expect(token).not.toContain('2026')
  })

  it('preserves millisecond precision (cursor must land on the exact boundary row)', () => {
    const cursor = { publishedAt: new Date('2026-06-15T00:00:00.001Z'), id: 'z' }
    expect(decodeReviewCursor(encodeReviewCursor(cursor))?.publishedAt.toISOString()).toBe(
      '2026-06-15T00:00:00.001Z',
    )
  })

  it('returns undefined for a non-base64 token (route answers 400, not 500)', () => {
    expect(decodeReviewCursor('!!!not base64!!!')).toBeUndefined()
  })

  it('returns undefined when the payload has no separator', () => {
    expect(decodeReviewCursor(btoa('no-separator-here'))).toBeUndefined()
  })

  it('returns undefined for an unparseable date', () => {
    expect(decodeReviewCursor(btoa('not-a-date|someid'))).toBeUndefined()
  })

  it('returns undefined for an empty id', () => {
    expect(decodeReviewCursor(btoa('2026-06-15T00:00:00.000Z|'))).toBeUndefined()
  })
})
