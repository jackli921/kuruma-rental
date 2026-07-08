import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { useLayoutEffect, useRef } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// The repo tests route components by mocking the router hooks (no RouterProvider). Here the
// mock lets a test drive `resolvedLocation.href` to model a completed navigation, exercising
// the real component wiring (the selector + the localized label), not just the hook.
const href = vi.hoisted(() => ({ value: '/en' }))
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ resolvedLocation: { href: href.value } }),
}))

import { RouteAnnouncer } from './RouteAnnouncer'

function renderAnnouncer() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <RouteAnnouncer />
    </IntlProvider>,
  )
}

afterEach(() => {
  href.value = '/en'
})

describe('RouteAnnouncer (#1489)', () => {
  it('renders a visually-hidden, focusable, localized anchor', () => {
    renderAnnouncer()
    const anchor = screen.getByRole('region', { name: 'Page content' })
    expect(anchor).toHaveClass('sr-only')
    expect(anchor).toHaveAttribute('tabindex', '-1')
  })

  it('does not grab focus on the initial resolution', () => {
    href.value = '/en/dashboard'
    renderAnnouncer()
    expect(screen.getByRole('region', { name: 'Page content' })).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })

  it('focuses the anchor when a completed navigation leaves focus on <body>', () => {
    href.value = '/en/a'
    const { rerender } = renderAnnouncer() // initial resolve -> seeded, no steal

    href.value = '/en/b' // navigation completes to a new location
    rerender(
      <IntlProvider locale="en" messages={en}>
        <RouteAnnouncer />
      </IntlProvider>,
    )

    expect(screen.getByRole('region', { name: 'Page content' })).toHaveFocus()
  })
})

// #1508: RouteAnnouncer is the app-wide fallback — a per-component restorer nested UNDER it
// (e.g. FleetTimeline's #1471 region restore) must win on a shared navigation, with the
// announcer standing down. This only holds when the announcer WRAPS the content: its own
// layout effect then fires after its descendants' (React post-order), so a deeper restorer
// reclaims focus first. (As a preceding sibling of <Outlet>, the announcer's effect fired
// FIRST and pre-empted the region restore onto the invisible anchor — the bug this fixes.)
function ChildRestorer({ navKey }: { navKey: string }) {
  const ref = useRef<HTMLElement>(null)
  const prev = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (prev.current === null) {
      prev.current = navKey // first resolution = seed, never steal
      return
    }
    if (prev.current === navKey) return
    prev.current = navKey
    if (document.activeElement === document.body) ref.current?.focus()
  }, [navKey])
  return <section ref={ref} tabIndex={-1} aria-label="component region" />
}

describe('RouteAnnouncer focus precedence (#1508)', () => {
  function Tree({ navKey, showTransient }: { navKey: string; showTransient: boolean }) {
    return (
      <IntlProvider locale="en" messages={en}>
        <RouteAnnouncer>
          {showTransient ? (
            <button type="button" data-testid="transient">
              x
            </button>
          ) : null}
          <ChildRestorer navKey={navKey} />
        </RouteAnnouncer>
      </IntlProvider>
    )
  }

  it('defers to a nested per-component restorer — the app-wide anchor stands down', () => {
    href.value = '/en/a'
    const { rerender } = render(<Tree navKey="a" showTransient />)

    // Focus a transient control, then one navigation unmounts it AND bumps both nav keys in
    // the same commit (models the search-param date nav that strands focus on <body>).
    screen.getByTestId('transient').focus()
    href.value = '/en/b'
    rerender(<Tree navKey="b" showTransient={false} />)

    // The descendant (deeper fiber) restores first to its own region; the announcer then sees
    // a live element and does NOT pull focus to the invisible sr-only anchor.
    expect(screen.getByRole('region', { name: 'component region' })).toHaveFocus()
    expect(screen.getByRole('region', { name: 'Page content' })).not.toHaveFocus()
  })

  it('still catches a cold remount where no descendant restorer runs', () => {
    // The child mounts fresh (its seed guard suppresses restore), so nobody reclaims focus —
    // the announcer must remain the fallback and focus its anchor.
    href.value = '/en/a'
    const { rerender } = render(<Tree navKey="a" showTransient />)

    screen.getByTestId('transient').focus()
    href.value = '/en/b'
    // navKey stays 'a' -> the child's restorer is seeded/no-op, modelling a freshly mounted
    // subtree that cannot restore its own focus.
    rerender(<Tree navKey="a" showTransient={false} />)

    expect(screen.getByRole('region', { name: 'Page content' })).toHaveFocus()
  })
})
