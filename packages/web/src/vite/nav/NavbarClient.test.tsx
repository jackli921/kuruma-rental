import { LayoutPreferenceProvider } from '@/vite/LayoutPreferenceProvider'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { beforeEach, describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import { LayoutToggle } from './NavbarClient'

const STORAGE_KEY = 'kuruma-layout-preference'

function renderToggle() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <LayoutPreferenceProvider>
        <LayoutToggle />
      </LayoutPreferenceProvider>
    </IntlProvider>,
  )
}

describe('LayoutToggle tooltip', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows a translated "switch to top navigation" tooltip while the sidebar is active', () => {
    localStorage.setItem(STORAGE_KEY, 'sidebar')
    renderToggle()
    expect(screen.getByRole('button').getAttribute('title')).toBe('Switch to top navigation')
  })

  it('shows a translated "switch to sidebar" tooltip while the top nav is active', () => {
    localStorage.setItem(STORAGE_KEY, 'topnav')
    renderToggle()
    expect(screen.getByRole('button').getAttribute('title')).toBe('Switch to sidebar')
  })
})
