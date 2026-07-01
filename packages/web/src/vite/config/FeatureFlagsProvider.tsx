import type { FeatureFlagKey, FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useMemo } from 'react'
import { featureFlagsQueryOptions, resolveFeatureFlag } from './feature-flags-runtime'

// Empty overrides => every flag falls back to its build-time default, so a
// consumer rendered outside the provider (or before the query resolves) behaves
// exactly as the build baked it. A missing provider must never break a gate.
const FeatureFlagOverridesContext = createContext<FeatureFlagOverrides>({})

export function FeatureFlagsProvider({ children }: { readonly children: React.ReactNode }) {
  const { data } = useQuery(featureFlagsQueryOptions())
  // initialData:{} guarantees `data` is defined; memo keeps the context value
  // identity stable between renders that don't change the override map.
  const overrides = useMemo(() => data ?? {}, [data])
  return (
    <FeatureFlagOverridesContext.Provider value={overrides}>
      {children}
    </FeatureFlagOverridesContext.Provider>
  )
}

/**
 * Synchronous effective read for a runtime-toggleable flag:
 * effective = server override ?? build-time default ?? false.
 *
 * First paint uses the build-time default (no flash), then reconciles to the
 * server override when the flags query resolves. Swap a `isFeatureXEnabled()`
 * call site for `useFeatureFlag('X')` to make that flag dashboard-toggleable.
 */
export function useFeatureFlag(key: FeatureFlagKey): boolean {
  const overrides = useContext(FeatureFlagOverridesContext)
  return resolveFeatureFlag(overrides, key)
}
