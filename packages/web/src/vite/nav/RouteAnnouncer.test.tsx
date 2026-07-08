import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
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
