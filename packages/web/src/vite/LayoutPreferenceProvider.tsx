import type { LayoutPreference } from '@/vite/nav/business-sidebar-visibility'
import { createContext, useCallback, useContext, useState } from 'react'

interface LayoutPreferenceContextValue {
  readonly preference: LayoutPreference
  readonly toggle: () => void
}

const STORAGE_KEY = 'kuruma-layout-preference'
const DEFAULT_PREFERENCE: LayoutPreference = 'sidebar'

const LayoutPreferenceContext = createContext<LayoutPreferenceContextValue>({
  preference: DEFAULT_PREFERENCE,
  toggle: () => {},
})

// Read synchronously at init so a consumer (BusinessLayout) never renders the
// default first and flips after mount — that flash is visible now that something
// consumes the preference. Safe because this is a client-only SPA render (no SSR,
// so no hydration mismatch).
function readStoredPreference(): LayoutPreference {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'sidebar' || stored === 'topnav' ? stored : DEFAULT_PREFERENCE
}

export function LayoutPreferenceProvider({ children }: { readonly children: React.ReactNode }) {
  const [preference, setPreference] = useState<LayoutPreference>(readStoredPreference)

  const toggle = useCallback(() => {
    setPreference((prev) => {
      const next = prev === 'sidebar' ? 'topnav' : 'sidebar'
      localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  return (
    <LayoutPreferenceContext.Provider value={{ preference, toggle }}>
      {children}
    </LayoutPreferenceContext.Provider>
  )
}

export function useLayoutPreference(): LayoutPreferenceContextValue {
  return useContext(LayoutPreferenceContext)
}
