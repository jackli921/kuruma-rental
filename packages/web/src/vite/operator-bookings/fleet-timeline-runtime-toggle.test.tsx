import { FeatureFlagsProvider } from '@/vite/config'
import { BookingsCalendar } from '@/vite/operator-bookings/BookingsCalendar'
import type { CalendarItem, CalendarResource } from '@/vite/operator-bookings/calendar-events'
import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// Proves FLEET_TIMELINE is driven by the runtime override layer, not just the
// build-time env: a DB override wins over the baked-in default at the live UI. The
// BookingsCalendar's view switcher renders the Timeline button only when the flag
// is effectively ON, so its presence/absence is a clean signal for the effective
// flag value. Only rbc's <Calendar> is stubbed (heavy jsdom drag); the real
// CalendarToolbar renders so the view buttons can be asserted.
vi.mock('react-big-calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-big-calendar')>()),
  Calendar: () => null,
}))

function renderCalendar(overrides: FeatureFlagOverrides) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['feature-flags'], overrides)
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={enMessages}>
        <FeatureFlagsProvider>
          <BookingsCalendar
            events={[] as readonly CalendarItem[]}
            resources={[] as readonly CalendarResource[]}
            view="week"
            date={new Date('2026-07-01T00:00:00.000Z')}
            locale="en"
            onViewChange={vi.fn()}
            onDateChange={vi.fn()}
            onSelectEvent={vi.fn()}
          />
        </FeatureFlagsProvider>
      </IntlProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('FLEET_TIMELINE runtime override reaches the live calendar', () => {
  it('a server override ON adds the Timeline view button even when the build default is OFF', () => {
    vi.stubEnv('VITE_FEATURE_FLEET_TIMELINE', '')
    renderCalendar({ FLEET_TIMELINE: true })
    expect(screen.getByRole('button', { name: 'Timeline' })).toBeInTheDocument()
  })

  it('a server override OFF drops the Timeline view button even when the build default is ON', () => {
    vi.stubEnv('VITE_FEATURE_FLEET_TIMELINE', 'true')
    renderCalendar({ FLEET_TIMELINE: false })
    expect(screen.queryByRole('button', { name: 'Timeline' })).toBeNull()
  })
})
