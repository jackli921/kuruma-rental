import { CalendarToolbar } from '@/vite/operator-bookings/CalendarToolbar'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const cal = en.business.bookings.calendar

function renderToolbar(overrides: Partial<ComponentProps<typeof CalendarToolbar>> = {}) {
  const onNavigate = vi.fn()
  const onView = vi.fn()
  render(
    <IntlProvider locale="en" messages={en}>
      <CalendarToolbar
        label="July 2026"
        view="week"
        onNavigate={onNavigate}
        onView={onView}
        {...overrides}
      />
    </IntlProvider>,
  )
  return { onNavigate, onView }
}

describe('CalendarToolbar', () => {
  it('gives the icon-only prev/next buttons accessible names', () => {
    renderToolbar()
    // Without an aria-label these icon-only buttons announce as a bare "button".
    expect(screen.getByRole('button', { name: cal.previous })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: cal.next })).toBeInTheDocument()
  })

  it('navigates PREV / NEXT when the named buttons are clicked', () => {
    const { onNavigate } = renderToolbar()
    fireEvent.click(screen.getByRole('button', { name: cal.previous }))
    fireEvent.click(screen.getByRole('button', { name: cal.next }))
    expect(onNavigate).toHaveBeenNthCalledWith(1, 'PREV')
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'NEXT')
  })

  it('keeps the TODAY control reachable by its visible text', () => {
    const { onNavigate } = renderToolbar()
    fireEvent.click(screen.getByRole('button', { name: cal.today }))
    expect(onNavigate).toHaveBeenCalledWith('TODAY')
  })
})
