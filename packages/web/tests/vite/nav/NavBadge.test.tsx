import { NavBadge } from '@/vite/nav/NavBadge'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('NavBadge', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<NavBadge count={0} label="0 new bookings" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a negative count', () => {
    const { container } = render(<NavBadge count={-1} label="x" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the exact count with a status role and aria-label', () => {
    render(<NavBadge count={3} label="3 new bookings" />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveTextContent('3')
    expect(badge).toHaveAttribute('aria-label', '3 new bookings')
  })

  it('caps the visible count at 9+ while keeping the full aria-label', () => {
    render(<NavBadge count={12} label="12 new bookings" />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveTextContent('9+')
    expect(badge).toHaveAttribute('aria-label', '12 new bookings')
  })
})
