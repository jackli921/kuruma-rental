import '@testing-library/jest-dom/vitest'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import { RouteAnnouncer } from './RouteAnnouncer'

// #1489 follow-up (architect concern): a `beforeLoad` `throw redirect()` on a COLD load must
// not be misread as a post-mount navigation and steal focus to the announcer (WCAG 3.2.1: no
// focus change on load). This is a real-router pin — the app's redirects all live in
// `beforeLoad`, so an entire redirect chain is caught mid-load as ONE continuous pending phase
// and `resolvedLocation` settles exactly ONCE, on the final target. The `resolvedLocation.href`
// keyed hook then seeds that single settle as the initial load and never focuses.
//
// The pin guards the mechanism the fix depends on: if a future @tanstack/react-router upgrade
// starts emitting a second pre-interaction settle for a redirect chain, `settles` grows past 1
// (diagnostic) and focus gets stolen (the user-facing regression) — both go red here.
//
// Separate file from RouteAnnouncer.test.tsx because that file `vi.mock`s the whole router
// module; this one drives the real router.

function buildRedirectChainTree() {
  const rootRoute = createRootRoute({
    // Mirror the real locale-layout mount: RouteAnnouncer WRAPS the routed content (#1508).
    component: () => (
      <RouteAnnouncer>
        <Outlet />
      </RouteAnnouncer>
    ),
  })
  // Chained redirect `/` -> `/mid` -> `/dest`: the most adversarial cold-load shape for the
  // "settles once" invariant, and a superset of the single-redirect case.
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
      // `href` (an arbitrary string), not `to` (checked against the app's real route tree via
      // the global Register augmentation) — these throwaway paths aren't app routes.
      throw redirect({ href: '/mid' })
    },
  })
  const midRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/mid',
    beforeLoad: () => {
      throw redirect({ href: '/dest' })
    },
  })
  const destRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dest',
    component: () => (
      <button type="button" data-testid="dest">
        dest
      </button>
    ),
  })
  return rootRoute.addChildren([indexRoute, midRoute, destRoute])
}

describe('RouteAnnouncer cold-load redirect chain (#1489 follow-up)', () => {
  it('settles once and does not steal focus when beforeLoad redirects on cold load', async () => {
    const settles: string[] = []
    const router = createRouter({
      routeTree: buildRedirectChainTree(),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    router.subscribe('onResolved', (event) => {
      settles.push(event.toLocation.href)
    })

    render(
      <IntlProvider locale="en" messages={en}>
        <RouterProvider router={router} />
      </IntlProvider>,
    )

    // The chain has fully resolved once the final target renders.
    await waitFor(() => expect(screen.getByTestId('dest')).toBeInTheDocument())

    // Diagnostic pin: the whole `/` -> `/mid` -> `/dest` chain is one continuous load, so
    // exactly one settle reaches the component — on the final target, never the intermediates.
    expect(settles).toEqual(['/dest'])

    // User-facing pin: cold load = initial load, so focus is left on the document root, not
    // yanked to the announcer.
    expect(screen.getByRole('region', { name: 'Page content' })).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })
})
