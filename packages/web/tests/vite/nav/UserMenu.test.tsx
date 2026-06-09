import { UserMenu, getInitials } from '@/vite/nav/UserMenu'
import type { Session } from '@/vite/session'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))

const session: Session = {
  user: { id: 'u1', role: 'OPERATOR_OWNER', name: 'Aiko Tanaka', email: 'aiko@example.com' },
  csrfToken: 'csrf-1',
}

function renderMenu(canSwitchView = true) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <UserMenu session={session} canSwitchView={canSwitchView} viewMode="business" />
    </IntlProvider>,
  )
}

describe('getInitials', () => {
  it.each([
    ['Aiko Tanaka', 'AT'],
    ['Madonna', 'M'],
    ['jean-luc picard', 'JP'],
    [undefined, '?'],
    [null, '?'],
  ])('maps %s to %s', (name, expected) => {
    expect(getInitials(name)).toBe(expected)
  })
})

describe('UserMenu', () => {
  it('shows the signed-in user name in the trigger', () => {
    renderMenu()
    expect(screen.getByText('Aiko Tanaka')).toBeInTheDocument()
  })
})
