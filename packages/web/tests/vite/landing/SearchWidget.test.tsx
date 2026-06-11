import { SearchWidget } from '@/vite/landing/SearchWidget'
import { persistSearchRange, readPersistedRange } from '@/vite/storefronts/storage'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    // 05:37 UTC = 14:37 JST -> default pickup ceils to 15:00 JST.
    vi.setSystemTime(new Date('2026-06-11T05:37:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    sessionStorage.clear()
    mockNavigate.mockClear()
    cleanup()
  })

  it('prefills both inputs with the next-hour pickup and +3 day return by default', () => {
    renderWidget()
    expect(screen.getByLabelText('Pickup date')).toHaveValue('2026-06-11T15:00')
    expect(screen.getByLabelText('Return date')).toHaveValue('2026-06-14T15:00')
  })

  it('restores the persisted range instead of the defaults when one exists', () => {
    persistSearchRange('2026-09-01T08:00', '2026-09-05T08:00')
    renderWidget()
    expect(screen.getByLabelText('Pickup date')).toHaveValue('2026-09-01T08:00')
    expect(screen.getByLabelText('Return date')).toHaveValue('2026-09-05T08:00')
  })

  it('persists the chosen range on submit so it survives leaving and returning', () => {
    renderWidget()
    fireEvent.change(screen.getByLabelText('Pickup date'), {
      target: { value: '2026-07-01T10:00' },
    })
    fireEvent.change(screen.getByLabelText('Return date'), {
      target: { value: '2026-07-03T10:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(readPersistedRange()).toEqual({ from: '2026-07-01T10:00', to: '2026-07-03T10:00' })
  })

  it('renders the location, both date inputs, and the search button', () => {
    renderWidget()
    expect(screen.getByText('Osaka, Japan')).toBeInTheDocument()
    expect(screen.getByLabelText('Pickup date')).toBeInTheDocument()
    expect(screen.getByLabelText('Return date')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument()
  })

  it('navigates to the locale-scoped storefront search carrying the chosen range', () => {
    renderWidget()
    fireEvent.change(screen.getByLabelText('Pickup date'), {
      target: { value: '2026-07-01T10:00' },
    })
    fireEvent.change(screen.getByLabelText('Return date'), {
      target: { value: '2026-07-03T10:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(mockNavigate).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$locale/search',
      params: { locale: 'en' },
      search: { from: '2026-07-01T10:00', to: '2026-07-03T10:00' },
    })
  })
})
