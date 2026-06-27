import { CurrencyProvider } from '@/vite/currency'
import type { FxRates } from '@kuruma/shared/types/fx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { ConfirmStep } from './ConfirmStep'
import type { ReservationEstimate } from './pricing'

const rates: FxRates = { base: 'JPY', asOf: '2026-06-01', rates: { USD: 0.0067 } }

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: rates }),
  })
})
afterEach(() => fetchMock.mockReset())

// base 10,000 ≠ total 30,000 on purpose, so converting the WRONG field shows a
// different figure: total -> $201, base -> $67.
const estimate: ReservationEstimate = { baseJpy: 10_000, insuranceJpy: 0, totalJpy: 30_000 }

function renderConfirm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        <CurrencyProvider>
          <ConfirmStep
            estimate={estimate}
            selectedAddOns={[]}
            insuranceName={null}
            pickupAt={new Date('2026-09-10T10:00:00Z')}
          />
        </CurrencyProvider>
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('ConfirmStep indicative total', () => {
  it('converts the TOTAL (not the base) for the indicative note', async () => {
    renderConfirm()
    // 30,000 * 0.0067 = 201 -> "$201"; the base (10,000 -> "$67") must NOT appear.
    await waitFor(() => expect(screen.getByText(/≈ \$201/)).toBeTruthy())
    expect(screen.queryByText(/\$67\b/)).toBeNull()
  })

  it('shows the charged-in-JPY disclaimer while a converted figure is on screen', async () => {
    renderConfirm()
    await waitFor(() => expect(screen.getByText(en.currency.disclaimer)).toBeTruthy())
  })
})
