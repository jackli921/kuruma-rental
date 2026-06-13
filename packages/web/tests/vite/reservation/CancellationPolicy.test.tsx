import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mirror the repo convention: stub use-intl so labels surface as their keys and
// the test asserts wiring (which tier is active), not the translated copy.
vi.mock('use-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { CancellationPolicy } from '@/vite/reservation/CancellationPolicy'

const HOUR_MS = 60 * 60 * 1000
const pickupIn = (hours: number): Date => new Date(Date.now() + hours * HOUR_MS)

const activeRows = (): HTMLElement[] =>
  screen.getAllByRole('listitem').filter((li) => li.getAttribute('aria-current') === 'true')

describe('CancellationPolicy — tiered schedule with the active tier highlighted', () => {
  afterEach(() => cleanup())

  it('renders every tier in the schedule', () => {
    render(<CancellationPolicy pickupAt={pickupIn(100)} />)
    for (const key of ['tiers.FREE', 'tiers.LOW', 'tiers.MEDIUM', 'tiers.FULL']) {
      expect(screen.getByText(key)).toBeInTheDocument()
    }
  })

  it.each([
    [100, 'tiers.FREE'], // 72h+
    [50, 'tiers.LOW'], // 48-72h
    [30, 'tiers.MEDIUM'], // 24-48h
    [10, 'tiers.FULL'], // <24h
    [-1, 'tiers.FULL'], // after pickup
  ])('with pickup %ih away highlights exactly %s', (hours, expectedKey) => {
    render(<CancellationPolicy pickupAt={pickupIn(hours)} />)
    const active = activeRows()
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveTextContent(expectedKey)
    expect(active[0]).toHaveTextContent('appliesNow')
  })
})
