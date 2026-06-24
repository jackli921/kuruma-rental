import { describe, expect, it } from 'vitest'
import { canonicalizeFields, computeContentHash } from './consent-canonical'

describe('canonicalizeFields', () => {
  it('is order-stable and unambiguous (length-prefixed)', () => {
    expect(
      canonicalizeFields([
        ['a', 'x'],
        ['b', null],
      ]),
    ).toBe('a\x1f1:x\x1eb\x1fN:\x1e')
  })

  it('distinguishes null from the empty string', () => {
    expect(canonicalizeFields([['x', null]])).not.toBe(canonicalizeFields([['x', '']]))
  })
})

describe('computeContentHash', () => {
  it('hashes the full disclosure (title, body, acceptanceLabel) deterministically', () => {
    const h1 = computeContentHash({ title: 'T', body: 'B', acceptanceLabel: 'L' })
    const h2 = computeContentHash({ title: 'T', body: 'B', acceptanceLabel: 'L' })
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(computeContentHash({ title: 'T', body: 'B2', acceptanceLabel: 'L' })).not.toBe(h1)
  })
})
