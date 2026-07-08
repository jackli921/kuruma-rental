import { type RefObject, useLayoutEffect, useRef } from 'react'

/**
 * #1489: return keyboard/screen-reader focus to a stable anchor after a client-side
 * navigation that stranded it on `<body>`.
 *
 * When a route change (or a `pendingComponent` swap on a slow/cold nav) unmounts the
 * element that had focus, the browser drops focus to `<body>`, so a screen-reader user
 * loses their place and reads from the top of the page. On each COMPLETED navigation
 * (`navKey` = the resolved-location key), if focus has fallen to `<body>`, move it to
 * `anchorRef`. Focus that is still on a live element — stable nav chrome (a Navbar link)
 * drove the nav — is left untouched, so ordinary link-to-link navigation is unaffected.
 *
 * The first non-empty key is the initial page load, not a navigation, so it never steals
 * focus (WCAG 3.2.1: no focus change on load). `prevKeyRef` starts null and is seeded by
 * that first key without focusing.
 *
 * `useLayoutEffect` (not `useEffect`): restore synchronously post-commit/pre-paint so focus
 * never sits on `<body>` for a painted frame (which can bump an AT virtual cursor to the top
 * of the page). Client-only Vite SPA — no SSR caveat.
 */
export function useRouteFocusRestoration<T extends HTMLElement>(
  navKey: string,
  anchorRef: RefObject<T | null>,
): void {
  const prevKeyRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!navKey) return // not resolved yet
    if (prevKeyRef.current === null) {
      prevKeyRef.current = navKey // first resolution = initial load; never steal focus
      return
    }
    if (prevKeyRef.current === navKey) return // not a navigation
    prevKeyRef.current = navKey
    if (document.activeElement === document.body) anchorRef.current?.focus()
  }, [navKey, anchorRef])
}
