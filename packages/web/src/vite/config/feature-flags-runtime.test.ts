import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  featureFlagsQueryOptions,
  fetchFeatureFlagOverrides,
  isBuildTimeEnabled,
  resolveFeatureFlag,
} from './feature-flags-runtime'

// #1437: the SHARED_CATALOG kill-switch is serverOnly + default-ON. The web override
// map is SPARSE (a key present IFF an admin set it), so in the normal default-ON state
// there is NO override row for it. A naive resolver would then fall to the build-time
// reader, which for an envless flag yields false -> the catalog would hide ITSELF in
// its own default state (the "polarity trap"). resolveFeatureFlag must instead floor a
// serverOnly key to its registry serverDefault. These lock that in.
describe('resolveFeatureFlag - serverOnly flooring (polarity trap)', () => {
  const NO_OVERRIDES: FeatureFlagOverrides = {}

  it('floors SHARED_CATALOG to its serverDefault (ON) when the map is empty', () => {
    // The critical case: default state, no override row, no env. Must be ON, not off.
    expect(resolveFeatureFlag(NO_OVERRIDES, 'SHARED_CATALOG')).toBe(true)
  })

  it('lets an explicit admin override turn SHARED_CATALOG off', () => {
    expect(resolveFeatureFlag({ SHARED_CATALOG: false }, 'SHARED_CATALOG')).toBe(false)
  })

  it('lets an explicit admin override keep SHARED_CATALOG on', () => {
    expect(resolveFeatureFlag({ SHARED_CATALOG: true }, 'SHARED_CATALOG')).toBe(true)
  })

  it('does NOT floor a normal web flag - it falls to its (false) build-time reader', () => {
    // CANCELLATION has no override and no env set in the test env, so it resolves off.
    // This proves flooring is scoped to serverOnly keys, not applied blanket.
    expect(resolveFeatureFlag(NO_OVERRIDES, 'CANCELLATION')).toBe(false)
  })

  it('isBuildTimeEnabled returns false for a serverOnly flag (it has no reader)', () => {
    // Documents WHY resolveFeatureFlag must floor: the build-time reader alone is false.
    expect(isBuildTimeEnabled('SHARED_CATALOG')).toBe(false)
  })
})

// #1486 / #1476 (GA liveness). The runtime override is the control plane: a platform
// admin flips a flag in the switchboard and every client must honor it on the next
// load with NO rebuild. `initialData: {}` renders build-time defaults instantly (no
// boot flash), but React Query stamps supplied initialData as fetched "now" unless
// told otherwise, so with staleTime 60s a fresh queryClient serves the empty map for
// a full minute and never fetches the override. `initialDataUpdatedAt: 0` marks it
// stale, so refetchOnMount pulls the real overrides while the instant paint is kept.
// Without this, a go-live flip is invisible on every fresh page load for ~60s.
describe('featureFlagsQueryOptions - override liveness', () => {
  // A QueryObserver is exactly what useQuery (the FeatureFlagsProvider) builds, so its
  // getCurrentResult() reflects the real first-render state and the `isStale` flag that
  // refetchOnMount consults. No subscriber is attached, so no fetch is triggered here.
  function firstRender() {
    return new QueryObserver(new QueryClient(), featureFlagsQueryOptions()).getCurrentResult()
  }

  it('renders the empty override map instantly (no boot flash)', () => {
    expect(firstRender().data).toEqual({})
  })

  it('treats that initialData as stale so a fresh load refetches the override', () => {
    // stale === true is what makes refetchOnMount fetch /feature-flags on mount instead
    // of serving the baked-in defaults for staleTime; without initialDataUpdatedAt: 0 the
    // supplied map is dated "now" and the switchboard flip stays invisible for ~60s.
    expect(firstRender().isStale).toBe(true)
  })
})

// Route flag GATES call fetchQuery(featureFlagsQueryOptions()) in beforeLoad, which
// (unlike the provider's error-tolerant useQuery) propagates a rejected queryFn and
// would throw the whole route to its error boundary. So the reader must never reject:
// any transport or shape failure degrades to an empty map -> build-time defaults.
describe('fetchFeatureFlagOverrides - fail-safe', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves to an empty map when the fetch rejects (offline/DNS), never throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(fetchFeatureFlagOverrides()).resolves.toEqual({})
  })

  it('resolves to an empty map on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503 })))
    await expect(fetchFeatureFlagOverrides()).resolves.toEqual({})
  })

  it('keeps only known boolean override keys from an ok response', async () => {
    const body = { data: { overrides: { FLEET_TIMELINE: false, BOGUS: true, MESSAGING: 'x' } } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))
    // BOGUS is not a flag key and MESSAGING is not a boolean -> both dropped at the boundary.
    await expect(fetchFeatureFlagOverrides()).resolves.toEqual({ FLEET_TIMELINE: false })
  })
})
