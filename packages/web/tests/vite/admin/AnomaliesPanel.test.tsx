import { AnomaliesPanel } from '@/vite/admin/AnomaliesPanel'
import type { PaymentAnomalyView } from '@kuruma/shared/types/payment-anomaly'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('use-intl', () => ({ useTranslations: () => (key: string) => key }))

afterEach(() => cleanup())

const double: PaymentAnomalyView = {
  id: 'pa_1',
  kind: 'DOUBLE_PAYMENT',
  operatorId: 'op_1',
  bookingId: 'bk_double',
  receivedAmountJpy: 100_000,
  expectedAmountJpy: 100_000,
  currency: 'jpy',
  stripeEventId: 'evt_double',
  stripePaymentIntentId: 'pi_1',
  createdAt: '2026-06-10T03:00:00.000Z',
}

function rowOf(bookingId: string): HTMLElement {
  const cell = screen.getByText(bookingId)
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${bookingId}`)
  return row
}

describe('AnomaliesPanel', () => {
  it('shows the all-clear empty state when there are no anomalies', () => {
    render(<AnomaliesPanel anomalies={[]} locale="en" />)
    expect(screen.getByText('empty')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('renders a DOUBLE_PAYMENT row with kind, booking, amount and the stripe event id', () => {
    render(<AnomaliesPanel anomalies={[double]} locale="en" />)
    const row = rowOf('bk_double')
    expect(within(row).getByText('kind.DOUBLE_PAYMENT')).toBeInTheDocument()
    expect(within(row).getByText('evt_double')).toBeInTheDocument()
    // received and expected both render the amount (a duplicate of the same charge)
    expect(within(row).getAllByText('￥100,000')).toHaveLength(2)
  })

  it('labels an AMOUNT_MISMATCH and degrades a missing received amount to a dash', () => {
    const mismatch: PaymentAnomalyView = {
      ...double,
      id: 'pa_2',
      kind: 'AMOUNT_MISMATCH',
      bookingId: 'bk_mismatch',
      stripeEventId: 'evt_mismatch',
      receivedAmountJpy: null,
      stripePaymentIntentId: null,
    }
    render(<AnomaliesPanel anomalies={[mismatch]} locale="en" />)
    const row = rowOf('bk_mismatch')
    expect(within(row).getByText('kind.AMOUNT_MISMATCH')).toBeInTheDocument()
    // A null Stripe amount must render a dash, never "¥NaN".
    expect(within(row).getByText('—')).toBeInTheDocument()
    expect(within(row).queryByText(/NaN/)).not.toBeInTheDocument()
  })

  it('renders one row per anomaly plus the header row', () => {
    render(
      <AnomaliesPanel
        anomalies={[double, { ...double, id: 'pa_3', bookingId: 'bk_3', stripeEventId: 'evt_3' }]}
        locale="en"
      />,
    )
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })
})
