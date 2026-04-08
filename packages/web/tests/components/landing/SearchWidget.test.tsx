import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      'search.location': 'Location',
      'search.locationValue': 'Osaka, Japan',
      'search.pickupDate': 'Pickup date',
      'search.returnDate': 'Return date',
      'search.button': 'Search',
    }
    return messages[key] ?? key
  },
}))

// Mock the i18n routing (useRouter)
const mockPush = vi.fn()
vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Import after mocks
import { SearchWidget } from '@/components/landing/SearchWidget'

describe('SearchWidget', () => {
  beforeEach(() => {
    mockPush.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders pickup and return date inputs', () => {
    render(<SearchWidget />)

    expect(screen.getByLabelText('Pickup date')).toBeInTheDocument()
    expect(screen.getByLabelText('Return date')).toBeInTheDocument()
  })

  it('renders the search button', () => {
    render(<SearchWidget />)

    const button = screen.getByRole('button', { name: /search/i })
    expect(button).toBeInTheDocument()
  })

  it('renders the location display', () => {
    render(<SearchWidget />)

    expect(screen.getByText('Location')).toBeInTheDocument()
    expect(screen.getByText('Osaka, Japan')).toBeInTheDocument()
  })

  it('navigates to /vehicles with date query params on submit', () => {
    render(<SearchWidget />)

    const pickupInput = screen.getByLabelText('Pickup date')
    const returnInput = screen.getByLabelText('Return date')

    fireEvent.change(pickupInput, { target: { value: '2026-04-10' } })
    fireEvent.change(returnInput, { target: { value: '2026-04-15' } })

    const button = screen.getByRole('button', { name: /search/i })
    fireEvent.click(button)

    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith('/vehicles?from=2026-04-10&to=2026-04-15')
  })

  it('navigates to /vehicles without date params when no dates are selected', () => {
    render(<SearchWidget />)

    const button = screen.getByRole('button', { name: /search/i })
    fireEvent.click(button)

    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith('/vehicles')
  })

  it('navigates with only from param when only pickup date is set', () => {
    render(<SearchWidget />)

    const pickupInput = screen.getByLabelText('Pickup date')
    fireEvent.change(pickupInput, { target: { value: '2026-04-10' } })

    const button = screen.getByRole('button', { name: /search/i })
    fireEvent.click(button)

    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith('/vehicles?from=2026-04-10')
  })
})
