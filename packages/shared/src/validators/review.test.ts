import { describe, expect, it } from 'vitest'
import { editReviewSchema, reportReviewSchema, submitReviewSchema } from './review'

const BOOKING = '11111111-1111-4111-8111-111111111111'

describe('submitReviewSchema (#1067)', () => {
  it('accepts a well-formed review and trims the comment', () => {
    const parsed = submitReviewSchema.parse({
      bookingId: BOOKING,
      subject: 'OPERATOR',
      overall: 5,
      subRatings: { cleanliness: 4, communication: 5 },
      comment: '  Great trip  ',
    })
    expect(parsed).toMatchObject({
      bookingId: BOOKING,
      subject: 'OPERATOR',
      overall: 5,
      subRatings: { cleanliness: 4, communication: 5 },
      comment: 'Great trip',
    })
  })

  it('defaults subRatings to {} when omitted', () => {
    const parsed = submitReviewSchema.parse({ bookingId: BOOKING, subject: 'VEHICLE', overall: 3 })
    expect(parsed.subRatings).toEqual({})
  })

  it('rejects an overall outside 1-5', () => {
    expect(
      submitReviewSchema.safeParse({ bookingId: BOOKING, subject: 'OPERATOR', overall: 6 }).success,
    ).toBe(false)
    expect(
      submitReviewSchema.safeParse({ bookingId: BOOKING, subject: 'OPERATOR', overall: 0 }).success,
    ).toBe(false)
  })

  it('rejects a non-integer overall', () => {
    expect(
      submitReviewSchema.safeParse({ bookingId: BOOKING, subject: 'OPERATOR', overall: 4.5 })
        .success,
    ).toBe(false)
  })

  it('rejects a foreign sub-dimension key', () => {
    expect(
      submitReviewSchema.safeParse({
        bookingId: BOOKING,
        subject: 'OPERATOR',
        overall: 4,
        subRatings: { speed: 5 },
      }).success,
    ).toBe(false)
  })

  it('rejects a sub-rating value outside 1-5', () => {
    expect(
      submitReviewSchema.safeParse({
        bookingId: BOOKING,
        subject: 'OPERATOR',
        overall: 4,
        subRatings: { cleanliness: 9 },
      }).success,
    ).toBe(false)
  })

  it('rejects an unknown subject and a non-UUID bookingId', () => {
    expect(
      submitReviewSchema.safeParse({ bookingId: BOOKING, subject: 'PLATFORM', overall: 4 }).success,
    ).toBe(false)
    expect(
      submitReviewSchema.safeParse({ bookingId: 'nope', subject: 'OPERATOR', overall: 4 }).success,
    ).toBe(false)
  })
})

describe('editReviewSchema', () => {
  it('accepts content with no bookingId/subject (the review is identified by route)', () => {
    expect(editReviewSchema.parse({ overall: 2, subRatings: { value: 1 } })).toEqual({
      overall: 2,
      subRatings: { value: 1 },
    })
  })
})

describe('reportReviewSchema', () => {
  it('requires a non-empty reason', () => {
    expect(reportReviewSchema.safeParse({ reason: '' }).success).toBe(false)
    expect(reportReviewSchema.parse({ reason: 'spam' })).toEqual({ reason: 'spam' })
  })
})
