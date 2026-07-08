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
 *
 * The "focus fell to the document root" guard is also what lets this coexist with per-component
 * restorers (e.g. FleetTimeline focusing its own board region): React runs child effects before
 * parent effects, so a more-specific child restores first, and this parent then sees a live
 * element and stands down. This app-wide anchor is the fallback for the cold-remount path where
 * the child that owned focus is itself unmounted and can't run its effect.
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
    // Focus was stranded: removing the focused node resets `activeElement` to the document
    // root — `<body>` on most engines, `<html>` or `null` on others. Restore only then;
    // `preventScroll` keeps the hidden anchor from tugging the viewport.
    const active = document.activeElement
    if (!active || active === document.body || active === document.documentElement) {
      anchorRef.current?.focus({ preventScroll: true })
    }
  }, [navKey, anchorRef])
}
