import { BookingDetailStub } from '@/app/[locale]/(business)/manage/bookings/[id]/BookingDetailStub'
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/routing', () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    const m: Record<string, string> = {
      stubTitle: 'Booking detail',
      stubBody: `Full booking detail page coming soon — id: ${values?.id ?? ''}`,
      backToCalendar: 'Back to calendar',
    }
    return m[key] ?? key
  },
}))

afterEach(() => cleanup())

describe('BookingDetailStub', () => {
  it('renders the booking id from props in the body', () => {
    render(<BookingDetailStub id="bk_xyz789" />)
    expect(screen.getByText(/bk_xyz789/)).toBeInTheDocument()
  })

  it('renders a back link pointing to /manage/bookings', () => {
    render(<BookingDetailStub id="anything" />)
    const link = screen.getByRole('link', { name: /back to calendar/i })
    expect(link).toHaveAttribute('href', '/manage/bookings')
  })

  it('renders the stub title as a heading', () => {
    render(<BookingDetailStub id="x" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/booking detail/i)
  })
})
