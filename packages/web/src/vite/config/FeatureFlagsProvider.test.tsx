import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeatureFlagsProvider, useFeatureFlag } from './FeatureFlagsProvider'

// Seed the flags query with an override map that is fresh (staleTime 60s), so the
// provider reads it without firing a network fetch in the test.
function wrapperWith(overrides: FeatureFlagOverrides) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['feature-flags'], overrides)
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <FeatureFlagsProvider>{children}</FeatureFlagsProvider>
      </QueryClientProvider>
    )
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('useFeatureFlag', () => {
  it('falls back to the build-time default (ON) when no override is set', () => {
    vi.stubEnv('VITE_FEATURE_MULTI_CURRENCY', 'true')
    const { result } = renderHook(() => useFeatureFlag('MULTI_CURRENCY'), {
      wrapper: wrapperWith({}),
    })
    expect(result.current).toBe(true)
  })

  it('is OFF when neither an override nor the build default enables it', () => {
    vi.stubEnv('VITE_FEATURE_MULTI_CURRENCY', '')
    const { result } = renderHook(() => useFeatureFlag('MULTI_CURRENCY'), {
      wrapper: wrapperWith({}),
    })
    expect(result.current).toBe(false)
  })

  it('a server override ON wins over a build default OFF', () => {
    vi.stubEnv('VITE_FEATURE_MULTI_CURRENCY', '')
    const { result } = renderHook(() => useFeatureFlag('MULTI_CURRENCY'), {
      wrapper: wrapperWith({ MULTI_CURRENCY: true }),
    })
    expect(result.current).toBe(true)
  })

  it('a server override OFF wins over a build default ON', () => {
    vi.stubEnv('VITE_FEATURE_MULTI_CURRENCY', 'true')
    const { result } = renderHook(() => useFeatureFlag('MULTI_CURRENCY'), {
      wrapper: wrapperWith({ MULTI_CURRENCY: false }),
    })
    expect(result.current).toBe(false)
  })

  it('degrades to the build-time default with no provider in the tree', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', '')
    const { result } = renderHook(() => useFeatureFlag('REVIEWS'))
    expect(result.current).toBe(false)
  })
})
