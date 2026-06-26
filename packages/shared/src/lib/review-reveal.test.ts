import { describe, expect, it } from 'vitest'
import { type RevealInput, aggregateRatings, decideReveal, summarizeSides } from './review-reveal'

const DEADLINE = new Date('2026-07-15T00:00:00Z')
const BEFORE = new Date('2026-07-10T00:00:00Z')
const AFTER = new Date('2026-07-16T00:00:00Z')
const hidden: RevealInput = { publishedAt: null, revealDeadlineAt: DEADLINE }

describe('decideReveal (#1067 double-blind)', () => {
  it('reveals at `now` once the counterpart has submitted (before the window)', () => {
    expect(decideReveal(hidden, true, BEFORE)).toEqual(BEFORE)
  })

  it('keeps hidden when the counterpart has not submitted and the window is open', () => {
    expect(decideReveal(hidden, false, BEFORE)).toBeNull()
  })

  it('reveals at `now` when the window has elapsed even if the counterpart never submitted', () => {
    expect(decideReveal(hidden, false, AFTER)).toEqual(AFTER)
  })

  it('reveals exactly at the deadline instant (boundary is inclusive)', () => {
    expect(decideReveal(hidden, false, DEADLINE)).toEqual(DEADLINE)
  })

  it('returns the existing publishedAt unchanged (forward-only, never re-stamps)', () => {
    const published = new Date('2026-07-01T00:00:00Z')
    expect(
      decideReveal({ publishedAt: published, revealDeadlineAt: DEADLINE }, true, AFTER),
    ).toEqual(published)
  })
})

describe('summarizeSides', () => {
  it('reports both sides submitted when a renter and an operator review exist', () => {
    expect(summarizeSides([{ authorRole: 'RENTER' }, { authorRole: 'OPERATOR' }])).toEqual({
      renterSubmitted: true,
      operatorSubmitted: true,
      bothSubmitted: true,
    })
  })

  it('treats multiple renter reviews (operator + vehicle) as one renter side, no operator', () => {
    expect(summarizeSides([{ authorRole: 'RENTER' }, { authorRole: 'RENTER' }])).toEqual({
      renterSubmitted: true,
      operatorSubmitted: false,
      bothSubmitted: false,
    })
  })

  it('reports neither side for an empty list', () => {
    expect(summarizeSides([])).toEqual({
      renterSubmitted: false,
      operatorSubmitted: false,
      bothSubmitted: false,
    })
  })
})

describe('aggregateRatings (#1067 slice 5 foundation)', () => {
  it('returns count 0 and null average for no reviews', () => {
    expect(aggregateRatings([])).toEqual({ count: 0, averageOverall: null, subAverages: {} })
  })

  it('means overall and each sub-dimension across reviews', () => {
    const result = aggregateRatings([
      { overall: 5, subRatings: { cleanliness: 4, communication: 5 } },
      { overall: 3, subRatings: { cleanliness: 2, communication: 3 } },
    ])
    expect(result.count).toBe(2)
    expect(result.averageOverall).toBe(4)
    expect(result.subAverages).toEqual({ cleanliness: 3, communication: 4 })
  })

  it('averages a sub-dimension only over the reviews that supplied it (absent is not zero)', () => {
    const result = aggregateRatings([
      { overall: 4, subRatings: { value: 4 } },
      { overall: 2, subRatings: {} },
    ])
    expect(result.averageOverall).toBe(3)
    // value averaged over ONE review, not divided by 2.
    expect(result.subAverages).toEqual({ value: 4 })
  })
})
