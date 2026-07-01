import {
  type ViewMode,
  setViewMode as persistViewMode,
  readViewCookie,
  resolveViewMode,
} from '@/vite/view-mode'
import type { UserRole } from '@kuruma/shared/auth/roles'
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react'

interface ViewModeContextValue {
  /** Raw persisted `kuruma-view` cookie value; consumers resolve it against a role. */
  readonly storedView: string | undefined
  /** Persist the chosen view AND update React state so consumers re-render. */
  readonly setViewMode: (mode: ViewMode) => void
}

const ViewModeContext = createContext<ViewModeContextValue>({
  storedView: undefined,
  setViewMode: () => {},
})

// Reactive view-mode source (#1274). The `kuruma-view` cookie stays the persistence
// layer across reloads, but `document.cookie` is not observable — nothing re-renders
// when it changes, so the old cookie-write + router.invalidate() toggle needed a full
// page refresh before the nav tabs (and business sidebar) updated. Holding the stored
// value in React state and writing both on switch re-renders consumers immediately.
export function ViewModeProvider({ children }: { readonly children: ReactNode }) {
  const [storedView, setStoredView] = useState<string | undefined>(readViewCookie)

  const setViewMode = useCallback((mode: ViewMode) => {
    persistViewMode(mode)
    setStoredView(mode)
  }, [])

  const value = useMemo(() => ({ storedView, setViewMode }), [storedView, setViewMode])

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>
}

export function useViewModeContext(): ViewModeContextValue {
  return useContext(ViewModeContext)
}

/**
 * Resolved view for the given session role. Re-derives when the stored preference
 * changes (via setViewMode) or when the role arrives from the session query, and the
 * role gate still applies: a renter-only user can never be shown the business view.
 */
export function useViewMode(role: UserRole | undefined): ViewMode {
  const { storedView } = useViewModeContext()
  return resolveViewMode(role, storedView)
}
