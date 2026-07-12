import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { Route } from './welcome'

// Guard test harness — mirrors terms.guard.test.ts (stub the queryClient methods
// the guard actually calls rather than running a real QueryClient lifecycle).
//
// The guard calls:
//   1. context.queryClient.invalidateQueries({ queryKey: ['session'] })
//   2. context.queryClient.ensureQueryData(sessionQueryOptions())
//      → reads the fresh (re-fetched) session from the server
//
// Stubbing both allows precise control over return values and call-order verification.

interface StubSession {
  user: { operatorSlug?: string }
}

function runGuard(freshSession: StubSession | null): Promise<{
  invalidateQueriesSpy: ReturnType<typeof vi.fn>
  ensureQueryDataSpy: ReturnType<typeof vi.fn>
  result: unknown
}> {
  const invalidateQueriesSpy = vi.fn().mockResolvedValue(undefined)
  const ensureQueryDataSpy = vi.fn().mockResolvedValue(freshSession)

  const context = {
    queryClient: { invalidateQueries: invalidateQueriesSpy, ensureQueryData: ensureQueryDataSpy },
  }

  let resultPromise: Promise<unknown>
  try {
    resultPromise = (Route.options.beforeLoad as (arg: unknown) => Promise<unknown>)({
      context,
      params: { locale: 'en' },
    }).catch((err: unknown) => err)
  } catch (err) {
    resultPromise = Promise.resolve(err)
  }

  return resultPromise.then((result) => ({ invalidateQueriesSpy, ensureQueryDataSpy, result }))
}

describe('operator/welcome beforeLoad guard (session-invalidation)', () => {
  it('redirects to /$locale/dashboard when the fresh session has operatorSlug (approved)', async () => {
    const { invalidateQueriesSpy, ensureQueryDataSpy, result } = await runGuard({
      user: { operatorSlug: 'acme' },
    })

    // Stale-cache trap is closed: invalidate was called with the session key...
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['session'] })
    // ...and it ran BEFORE the re-read — reading first would return the stale RENTER
    // session and never redirect. This ordering is the whole point of the route.
    expect(invalidateQueriesSpy.mock.invocationCallOrder[0]).toBeLessThan(
      ensureQueryDataSpy.mock.invocationCallOrder[0] as number,
    )

    // Approved session → redirect into operator portal
    expect(isRedirect(result)).toBe(true)
    expect((result as { options?: { to?: string } }).options?.to).toBe('/$locale/dashboard')
  })

  it('does NOT redirect when the fresh session has no operatorSlug (still pending)', async () => {
    const { invalidateQueriesSpy, result } = await runGuard({ user: {} })

    // Invalidate still called — guard always re-checks
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['session'] })

    // Pending applicant → falls through to holding page, no redirect thrown
    expect(isRedirect(result)).toBe(false)
    expect(result).toBeUndefined()
  })
})
