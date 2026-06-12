import { AdminHomeView } from '@/vite/admin/AdminHomeView'
import { RevenuePlaceholderView } from '@/vite/admin/RevenuePlaceholderView'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

const renderView = (ui: ReactNode) =>
  render(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  )

describe('AdminHomeView', () => {
  it('shows the platform admin title + subtitle', () => {
    renderView(<AdminHomeView />)
    expect(screen.getByRole('heading', { name: 'Platform Admin' })).toBeInTheDocument()
    expect(screen.getByText('Platform operations')).toBeInTheDocument()
  })
})

describe('RevenuePlaceholderView', () => {
  it('shows the revenue placeholder with the 4% commission model copy', () => {
    renderView(<RevenuePlaceholderView />)
    expect(screen.getByRole('heading', { name: 'Partner Revenue' })).toBeInTheDocument()
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
    expect(screen.getByText(/4%/)).toBeInTheDocument()
  })
})
