import { CalendarToolbar } from '@/components/calendar/CalendarToolbar'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const m: Record<string, string> = {
      today: 'Today',
      'views.day': 'Day',
      'views.week': 'Week',
      'views.month': 'Month',
    }
    return m[key] ?? key
  },
}))

afterEach(() => cleanup())

describe('CalendarToolbar', () => {
  const noop = () => {}

  it('renders Day / Week / Month buttons when given all three views', () => {
    render(
      <CalendarToolbar
        label="Apr 2026"
        view="week"
        onNavigate={noop}
        onView={noop}
        views={['day', 'week', 'month']}
      />,
    )
    expect(screen.getByRole('button', { name: 'Day' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Week' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Month' })).toBeInTheDocument()
  })

  it('calls onView with the clicked view', () => {
    const onView = vi.fn()
    render(
      <CalendarToolbar
        label="Apr 2026"
        view="day"
        onNavigate={noop}
        onView={onView}
        views={['day', 'week', 'month']}
      />,
    )
    screen.getByRole('button', { name: 'Month' }).click()
    expect(onView).toHaveBeenCalledWith('month')
  })

  it('invokes onNavigate with PREV / NEXT / TODAY', () => {
    const onNavigate = vi.fn()
    render(
      <CalendarToolbar
        label="Apr 2026"
        view="month"
        onNavigate={onNavigate}
        onView={noop}
        views={['day', 'week', 'month']}
      />,
    )
    screen.getByRole('button', { name: 'Today' }).click()
    expect(onNavigate).toHaveBeenCalledWith('TODAY')
  })
})
