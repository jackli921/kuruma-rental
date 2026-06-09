import { SearchWidget } from '@/vite/landing/SearchWidget'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }))

function renderWidget() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <SearchWidget />
    </IntlProvider>,
  )
}

describe('SearchWidget', () => {
  it('renders the location, both date inputs, and the search button', () => {
    renderWidget()
    expect(screen.getByText('Osaka, Japan')).toBeInTheDocument()
    expect(screen.getByLabelText('Pickup date')).toBeInTheDocument()
    expect(screen.getByLabelText('Return date')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument()
  })

  it('navigates to the locale-scoped catalog on submit', () => {
    renderWidget()
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(mockNavigate).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$locale/vehicles',
      params: { locale: 'en' },
    })
  })
})
