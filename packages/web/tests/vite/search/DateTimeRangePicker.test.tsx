import { parseJstDateTimeLocal } from '@/lib/datetime'
import { DateTimeRangePicker } from '@/vite/search/DateTimeRangePicker'
import type { DateTimeRange } from '@/vite/search/datetime-range'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// JST 2026-06-11 14:37 — "now" for past-gating. A range well in the future keeps
// every 30-min slot selectable so the time dropdowns are deterministic.
const NOW = new Date('2026-06-11T05:37:00Z')
const RANGE: DateTimeRange = { from: '2026-06-20T10:00', to: '2026-06-22T10:00' }

function mockMatchMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function renderPicker(props: Partial<React.ComponentProps<typeof DateTimeRangePicker>> = {}) {
  const onChange = vi.fn()
  render(
    <IntlProvider locale="en" messages={en}>
      <DateTimeRangePicker value={RANGE} onChange={onChange} minDate={NOW} {...props} />
    </IntlProvider>,
  )
  return { onChange }
}

describe('DateTimeRangePicker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('shows the placeholder when no range is chosen', () => {
    mockMatchMedia(true)
    renderPicker({ value: null })
    expect(screen.getByRole('button', { name: /add dates & times/i })).toBeInTheDocument()
  })

  it('summarizes the committed range on the trigger', () => {
    mockMatchMedia(true)
    renderPicker()
    expect(screen.getByRole('button', { name: /Jun 20 10:00 → Jun 22 10:00/ })).toBeInTheDocument()
  })

  it('emits a recombined JST string that round-trips when the pickup time changes', async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const { onChange } = renderPicker()

    await user.click(screen.getByRole('button', { name: /Jun 20 10:00/ }))
    await user.click(screen.getByLabelText('Pickup time'))
    await user.click(screen.getByRole('option', { name: '12:30' }))

    expect(onChange).toHaveBeenCalledWith({ from: '2026-06-20T12:30', to: '2026-06-22T10:00' })
    // The contract: the emitted string parses as a valid JST instant.
    const emitted = onChange.mock.calls.at(-1)?.[0] as DateTimeRange
    expect(parseJstDateTimeLocal(emitted.from).toISOString()).toBe('2026-06-20T03:30:00.000Z')
  })

  it('re-syncs the trigger when the value prop changes externally', () => {
    mockMatchMedia(true)
    const { rerender } = render(
      <IntlProvider locale="en" messages={en}>
        <DateTimeRangePicker value={RANGE} onChange={vi.fn()} minDate={NOW} />
      </IntlProvider>,
    )
    expect(screen.getByRole('button', { name: /Jun 20 10:00 → Jun 22 10:00/ })).toBeInTheDocument()

    const next: DateTimeRange = { from: '2026-07-01T09:00', to: '2026-07-03T09:00' }
    rerender(
      <IntlProvider locale="en" messages={en}>
        <DateTimeRangePicker value={next} onChange={vi.fn()} minDate={NOW} />
      </IntlProvider>,
    )
    expect(screen.getByRole('button', { name: /Jul 1 09:00 → Jul 3 09:00/ })).toBeInTheDocument()
  })

  it('disables calendar days before today in JST', async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    render(
      <IntlProvider locale="en" messages={en}>
        <DateTimeRangePicker value={null} onChange={vi.fn()} minDate={NOW} />
      </IntlProvider>,
    )
    await user.click(screen.getByRole('button', { name: /add dates & times/i }))

    // data-day mirrors the picker's toLocaleDateString(undefined) day key.
    const dayKey = (y: number, m: number, d: number) => new Date(y, m - 1, d).toLocaleDateString()
    // NOW is JST 2026-06-11, so June 1 is past, June 20 is bookable.
    expect(document.body.querySelector(`[data-day="${dayKey(2026, 6, 1)}"]`)).toBeDisabled()
    expect(document.body.querySelector(`[data-day="${dayKey(2026, 6, 20)}"]`)).not.toBeDisabled()
  })

  it('renders the mobile bottom sheet when the viewport is narrow', async () => {
    mockMatchMedia(false)
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('button', { name: /Jun 20 10:00/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
