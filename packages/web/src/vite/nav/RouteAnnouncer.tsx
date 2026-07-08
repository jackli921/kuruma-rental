import { useRouteFocusRestoration } from '@/vite/nav/useRouteFocusRestoration'
import { useRouterState } from '@tanstack/react-router'
import { type PropsWithChildren, useRef } from 'react'
import { useTranslations } from 'use-intl'

/**
 * #1489: an app-wide focus-on-navigate anchor. Mounted once in the locale layout — a stable
 * parent that survives every child route change and the role layouts' `pendingComponent`
 * swaps — it returns focus to a visually-hidden anchor whenever a navigation strands focus
 * on `<body>`. The restoration policy (only when focus fell to `<body>`, never on the
 * initial load) lives in `useRouteFocusRestoration`.
 *
 * The nav key is `resolvedLocation.href`, which changes exactly when a navigation COMPLETES
 * (the new content is committed and the old subtree — with the element that had focus — is
 * unmounted). Keying on the pending `location` instead would fire before that unmount, while
 * focus is still on a live element, and miss the drop entirely.
 *
 * #1508: this WRAPS the routed content (`<RouteAnnouncer><Outlet/></RouteAnnouncer>`) instead
 * of sitting before it as a sibling, which makes it a true app-wide FALLBACK. React fires
 * layout effects in post-order, so any per-component restorer nested below (e.g. FleetTimeline's
 * #1471 board-region restore) runs FIRST and reclaims focus; this anchor's effect then sees a
 * live element and stands down. As a preceding sibling its effect fired first and pre-empted
 * those restores onto the invisible anchor. The anchor is still rendered before `children`, so
 * restored focus (and Tab order) lands at the content boundary, past the unchanged nav.
 */
export function RouteAnnouncer({ children }: PropsWithChildren) {
  const t = useTranslations('nav')
  // A named `<section>` (role="region") — not a bare `<div>` (role="generic", on which
  // `aria-label` is prohibited and dropped): a generic anchor is silent on VoiceOver, exactly
  // the AT #1471's stranded-focus bug lived on. Mirrors the FleetTimeline board region.
  const anchorRef = useRef<HTMLElement>(null)
  const navKey = useRouterState({ select: (s) => s.resolvedLocation?.href ?? '' })
  useRouteFocusRestoration(navKey, anchorRef)
  return (
    <>
      <section
        ref={anchorRef}
        tabIndex={-1}
        className="sr-only"
        aria-label={t('routeAnnouncerLabel')}
      />
      {children}
    </>
  )
}
