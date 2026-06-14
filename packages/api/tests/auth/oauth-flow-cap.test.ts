import { describe, expect, it } from 'vitest'

import {
  MAX_CONCURRENT_OAUTH_FLOWS,
  flowCookieName,
  flowCookiesToEvict,
} from '../../src/auth/google'

// #592: each abandoned Google sign-in leaves its per-flow cookie until the 600s TTL
// self-heals it. A user rapidly abandoning sign-ins (or a login-CSRF /start flood)
// could accumulate enough empty-payload cookies to blow the ~4KB per-domain header
// budget, at which point NEW logins start failing. `flowCookiesToEvict` decides which
// existing flow cookies /start must erase so that adding one more keeps the live
// count at or under the cap. We can't read a cookie's creation time from the request
// (the browser sends only name=value), so the contract bounds the COUNT — the actual
// threat — and picks victims deterministically (sorted) rather than by true age.

/** `n` distinct flow-cookie names, zero-padded so lexicographic === numeric order. */
function flowNames(n: number): string[] {
  return Array.from({ length: n }, (_, i) => flowCookieName(`s${String(i).padStart(3, '0')}`))
}

describe('flowCookiesToEvict', () => {
  it('evicts nothing when no flow cookies are present', () => {
    expect(flowCookiesToEvict([], 10)).toEqual([])
  })

  it('evicts nothing while there is still room for the new flow (at cap-1)', () => {
    // 9 existing + 1 about-to-be-added = 10 = cap, so nothing must be erased.
    expect(flowCookiesToEvict(flowNames(9), 10)).toEqual([])
  })

  it('evicts exactly one when already at the cap', () => {
    // 10 existing would become 11 after adding one — erase 1 to land back on 10.
    const evicted = flowCookiesToEvict(flowNames(10), 10)
    expect(evicted).toHaveLength(1)
  })

  it('evicts down to cap-1 when over the cap', () => {
    // 12 existing → keep 9, erase 3, so post-add total is exactly the cap.
    expect(flowCookiesToEvict(flowNames(12), 10)).toHaveLength(3)
  })

  it('keeps the largest cap-1 names and evicts the smallest (deterministic by sort)', () => {
    const names = flowNames(12)
    const evicted = flowCookiesToEvict(names, 10)
    // Victims are the 3 lexicographically-smallest; the kept set is the rest.
    expect(evicted).toEqual(names.slice(0, 3))
    const kept = names.filter((n) => !evicted.includes(n))
    expect(kept).toEqual(names.slice(3))
  })

  it('is order-independent: shuffled input yields the same victim set', () => {
    const names = flowNames(12)
    const shuffled = [...names].reverse()
    expect(flowCookiesToEvict(shuffled, 10)).toEqual(names.slice(0, 3))
  })

  it('honours a custom (small) cap of 2: two existing → erase the smaller one', () => {
    const [a, b] = [flowCookieName('a'), flowCookieName('b')]
    expect(flowCookiesToEvict([b, a], 2)).toEqual([a])
  })

  it('defaults the cap to MAX_CONCURRENT_OAUTH_FLOWS (10)', () => {
    expect(MAX_CONCURRENT_OAUTH_FLOWS).toBe(10)
    // 11 existing with the default cap → erase 2 (keep 9, +1 new = 10).
    expect(flowCookiesToEvict(flowNames(11))).toHaveLength(2)
  })
})
