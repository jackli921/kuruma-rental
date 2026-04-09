import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { BookingStatusBadge } from '@/components/bookings/BookingStatusBadge'

describe('BookingStatusBadge', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders "Confirmed" with green styling for CONFIRMED status', () => {
    render(<BookingStatusBadge status="CONFIRMED" />)

    const badge = screen.getByText('Confirmed')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('green')
  })

  it('renders "Active" with blue styling for ACTIVE status', () => {
    render(<BookingStatusBadge status="ACTIVE" />)

    const badge = screen.getByText('Active')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('blue')
  })

  it('renders "Completed" with gray styling for COMPLETED status', () => {
    render(<BookingStatusBadge status="COMPLETED" />)

    const badge = screen.getByText('Completed')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('gray')
  })

  it('renders "Cancelled" with red styling for CANCELLED status', () => {
    render(<BookingStatusBadge status="CANCELLED" />)

    const badge = screen.getByText('Cancelled')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('red')
  })

  it('renders custom label when provided', () => {
    render(<BookingStatusBadge status="CONFIRMED" label="確定済み" />)

    const badge = screen.getByText('確定済み')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('green')
  })
})
