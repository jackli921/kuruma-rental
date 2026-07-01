import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../../messages/en.json'
import { OperatorSummaryView } from './OperatorSummaryView'
import type { OperatorSummary } from './api'

const T = en.admin.operators.summary

const summary = (over: Partial<OperatorSummary> = {}): OperatorSummary => ({
  operatorId: 'op_1',
  name: 'Kanata Cars',
  vehicleCount: 12,
  vehiclesNeedingDocs: 2,
  vehiclesExpiringSoon: 1,
  totalBookings: 40,
  upcomingBookings: 5,
  lastComplianceAlertAt: '2026-06-20T09:30:00.000Z',
  ...over,
})

function renderView(over: Partial<OperatorSummary> = {}) {
  render(
    <IntlProvider locale="en" messages={en}>
      <OperatorSummaryView summary={summary(over)} locale="en" />
    </IntlProvider>,
  )
}

/** The value rendered in the stat tile under a given label (tile = label + value div). */
function tileValue(label: string): string {
  const tile = screen.getByText(label).parentElement
  if (!tile) throw new Error(`no tile for label "${label}"`)
  return tile.lastElementChild?.textContent ?? ''
}

describe('OperatorSummaryView (#1120)', () => {
  it('renders the operator name as the heading', () => {
    renderView()
    expect(screen.getByRole('heading', { name: 'Kanata Cars' })).not.toBeNull()
  })

  it('maps each figure to its labelled tile (distinct values guard wiring)', () => {
    renderView()
    expect(tileValue(T.vehicleCount)).toBe('12')
    expect(tileValue(T.needingDocs)).toBe('2')
    expect(tileValue(T.expiringSoon)).toBe('1')
    expect(tileValue(T.totalBookings)).toBe('40')
    expect(tileValue(T.upcomingBookings)).toBe('5')
  })

  it('formats the last compliance alert timestamp for the locale', () => {
    renderView({ lastComplianceAlertAt: '2026-06-20T09:30:00.000Z' })
    // Date is locale-formatted (not the raw ISO string).
    expect(tileValue(T.lastAlert)).not.toBe('2026-06-20T09:30:00.000Z')
    expect(tileValue(T.lastAlert)).toMatch(/2026/)
  })

  it('shows "Never" when the operator has no compliance alert', () => {
    renderView({ lastComplianceAlertAt: null })
    expect(tileValue(T.lastAlert)).toBe(T.never)
  })
})
