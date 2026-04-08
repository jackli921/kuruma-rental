'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type LayoutPreference = 'sidebar' | 'topnav'

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

export function LayoutPreferenceProvider({ children }: { readonly children: React.ReactNode }) {
  const [preference, setPreference] = useState<LayoutPreference>(DEFAULT_PREFERENCE)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'sidebar' || stored === 'topnav') {
      setPreference(stored)
    }
  }, [])

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
