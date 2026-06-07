import { LocaleSwitcher, localeSwapNav } from '@/vite/nav/LocaleSwitcher'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

function renderSwitcher(locale: string) {
  return render(
    <IntlProvider locale={locale} messages={{}}>
      <LocaleSwitcher />
    </IntlProvider>,
  )
}

describe('localeSwapNav (pure)', () => {
  it('swaps only the locale segment and replaces history, preserving other params', () => {
    const nav = localeSwapNav('en')
    expect(nav.to).toBe('.')
    expect(nav.replace).toBe(true)
    expect(nav.params({ locale: 'ja', storefrontId: 's1' })).toEqual({
      locale: 'en',
      storefrontId: 's1',
    })
  })
})

describe('LocaleSwitcher', () => {
  it('shows the active locale label in the trigger', () => {
    renderSwitcher('ja')
    expect(screen.getByText('日本語')).toBeInTheDocument()
  })
})
