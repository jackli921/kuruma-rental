import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      'filters.from': 'From',
      'filters.to': 'To',
    }
    return messages[key] ?? key
  },
}))

import { ActiveFilters } from '@/components/vehicles/ActiveFilters'

describe('ActiveFilters', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders pickup and return dates when both are provided', () => {
    render(<ActiveFilters from="2026-04-10" to="2026-04-15" />)

    expect(screen.getByText('From')).toBeInTheDocument()
    expect(screen.getByText('2026-04-10')).toBeInTheDocument()
    expect(screen.getByText('To')).toBeInTheDocument()
    expect(screen.getByText('2026-04-15')).toBeInTheDocument()
  })

  it('renders only pickup date when return date is absent', () => {
    render(<ActiveFilters from="2026-04-10" />)

    expect(screen.getByText('From')).toBeInTheDocument()
    expect(screen.getByText('2026-04-10')).toBeInTheDocument()
    expect(screen.queryByText('To')).not.toBeInTheDocument()
  })

  it('renders nothing when no dates are provided', () => {
    const { container } = render(<ActiveFilters />)

    // Container should have an empty div (or nothing rendered)
    expect(container.querySelector('[data-testid="active-filters"]')).not.toBeInTheDocument()
  })

  it('renders only return date when pickup date is absent', () => {
    render(<ActiveFilters to="2026-04-15" />)

    expect(screen.queryByText('From')).not.toBeInTheDocument()
    expect(screen.getByText('To')).toBeInTheDocument()
    expect(screen.getByText('2026-04-15')).toBeInTheDocument()
  })
})
