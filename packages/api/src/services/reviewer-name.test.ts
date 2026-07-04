import { describe, expect, it } from 'vitest'
import { toReviewerFirstName } from './reviewer-name'

// Privacy-critical (#1450): the public review list may surface a reviewer's FIRST name only.
// This derives it from the single OAuth `users.name` (no structured given/family split), and
// must NEVER return more than the first whitespace-delimited token — the rest of the name is
// PII the epic non-goal keeps off the anonymous public endpoint.
describe('toReviewerFirstName', () => {
  it('returns the first whitespace token of a multi-part name, never the full name', () => {
    expect(toReviewerFirstName('Jack Li')).toBe('Jack')
    expect(toReviewerFirstName('Maria del Carmen Fernandez')).toBe('Maria')
  })

  it('collapses leading/inner whitespace to the first real token', () => {
    expect(toReviewerFirstName('   Jack   Li  ')).toBe('Jack')
  })

  it('returns a single-token name unchanged', () => {
    expect(toReviewerFirstName('Jack')).toBe('Jack')
  })

  it('handles non-Latin scripts by splitting on whitespace only', () => {
    // Japanese "Family Given" order: the first token is the family name — a documented
    // limitation (the OAuth name carries no given/family structure), but still first-token-only.
    expect(toReviewerFirstName('田中 太郎')).toBe('田中')
  })

  it('returns null for an absent name so the caller falls back to the anonymous label', () => {
    expect(toReviewerFirstName(null)).toBeNull()
  })

  it('returns null for an empty or whitespace-only name (no usable token)', () => {
    expect(toReviewerFirstName('')).toBeNull()
    expect(toReviewerFirstName('   ')).toBeNull()
  })
})
