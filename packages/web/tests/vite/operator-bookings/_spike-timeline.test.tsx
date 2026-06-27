// SPIKE (#1100 gate) — THROWAWAY. Verifies react-calendar-timeline@0.30.0-beta.18
// mounts under React 19.2.4 + StrictMode with fleet-scale data. Delete once the
// build/buy gate decision is recorded on the issue.
import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import Timeline from 'react-calendar-timeline'
import 'react-calendar-timeline/style.css'
import { describe, expect, it } from 'vitest'

// react-calendar-timeline's resize-detector needs ResizeObserver (absent in happy-dom).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver?: typeof ResizeObserverStub }).ResizeObserver ??=
  ResizeObserverStub

describe('SPIKE #1100: react-calendar-timeline @0.30 under React 19 strict mode', () => {
  it('mounts 50 vehicles x 100 bookings without throwing', () => {
    const t0 = Date.UTC(2027, 0, 1)
    const DAY = 86_400_000
    const groups = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, title: `Vehicle ${i + 1}` }))
    const items = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      group: (i % 50) + 1,
      title: `Booking ${i + 1}`,
      start_time: t0 + (i % 30) * DAY,
      end_time: t0 + ((i % 30) + 2) * DAY,
    }))

    const { getByText } = render(
      <StrictMode>
        <Timeline
          groups={groups}
          items={items}
          defaultTimeStart={t0}
          defaultTimeEnd={t0 + 30 * DAY}
        />
      </StrictMode>,
    )

    // Sidebar renders each vehicle row label — proves groups mounted, not just root.
    expect(getByText('Vehicle 1')).toBeInTheDocument()
    expect(getByText('Vehicle 50')).toBeInTheDocument()
  })
})
