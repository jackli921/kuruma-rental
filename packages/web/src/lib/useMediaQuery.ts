import { useEffect, useState } from 'react'

/**
 * Track a CSS media query. Used to swap the date-time picker shell between a
 * desktop Popover and a mobile bottom Sheet (#965). SPA-only, but guards the
 * `matchMedia` lookup so it is inert under a server/test environment without it.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => getMatches(query))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const onChange = (): void => setMatches(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return matches
}

function getMatches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(query).matches
}
