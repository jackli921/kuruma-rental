import { LayoutPreferenceProvider } from '@/vite/LayoutPreferenceProvider'
import { ViewModeProvider } from '@/vite/ViewModeProvider'
import type { UserRole } from '@kuruma/shared/auth/roles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Drive the signed-in role through the session hook; the navbar's other seams
// (router Link, badges, currency/locale/mobile chrome) are stubbed so this test
// exercises the one thing under test: switching view updates the visible tab set
// in place, with no page reload. Typed as UserRole | undefined so a typo'd literal
// fails to compile.
const h = vi.hoisted(() => ({ role: 'OPERATOR_OWNER' as UserRole | undefined }))

vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { user: { id: 'u1', role: h.role, name: 'Ola Owner' } } }),
  signOut: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: unknown }) => (
    <a href={String(to)}>{children}</a>
  ),
  useRouter: () => ({ invalidate: vi.fn() }),
}))
vi.mock('@/vite/operator-bookings/useNewBookingsBadge', () => ({
  useNewBookingsBadge: () => ({ count: 0 }),
}))
vi.mock('@/vite/messaging/unread-badge', () => ({
  useUnreadBadge: () => ({ count: 0 }),
}))
vi.mock('@/vite/currency', () => ({ CurrencySelector: () => null }))
vi.mock('@/vite/nav/LocaleSwitcher', () => ({ LocaleSwitcher: () => null }))
vi.mock('@/vite/nav/MobileMenu', () => ({ MobileMenu: () => null }))

import { Navbar } from './Navbar'

function renderNavbar() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en}>
        <ViewModeProvider>
          <LayoutPreferenceProvider>
            <Navbar />
          </LayoutPreferenceProvider>
        </ViewModeProvider>
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('Navbar view switch reactivity (#1274)', () => {
  beforeEach(() => {
    localStorage.clear()
    document.cookie = 'kuruma-view=; path=/; max-age=0'
    h.role = 'OPERATOR_OWNER'
  })

  it('swaps business tabs for the renter Browse tab when the operator switches view, with no reload', async () => {
    renderNavbar()

    // Business view is the default for an operator with no saved preference.
    expect(screen.getByRole('link', { name: 'Fleet' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Classes' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Browse' })).toBeNull()

    // Open the avatar menu and click the switch item (the real end-user path).
    fireEvent.click(screen.getByRole('button', { name: /Ola Owner/i }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch to renter view' }))

    // Reactive: the nav re-renders in place — the renter Browse tab appears and the
    // business Fleet/Classes tabs are gone. No router.invalidate, no reload.
    expect(await screen.findByRole('link', { name: 'Browse' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Fleet' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Classes' })).toBeNull()
  })
})
