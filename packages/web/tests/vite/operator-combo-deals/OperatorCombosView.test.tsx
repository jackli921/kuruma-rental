import { ApiError } from '@/lib/api-error'
import { OperatorCombosView } from '@/vite/operator-combo-deals/OperatorCombosView'
import { type ClassRatePlanData, updateComboDeal } from '@/vite/operator-combo-deals/api'
import type { OperatorScope } from '@/vite/operator-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const COMBO = en.business.comboDeals

// The view reads the CSRF token from the session and PATCHes via updateComboDeal
// for the direct activate/deactivate toggle; both are stubbed so the test asserts
// the wiring (what is sent, how a failure surfaces), not real network I/O.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'csrf_1' } }),
}))
vi.mock('@/vite/operator-combo-deals/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-combo-deals/api')>()
  return { ...actual, updateComboDeal: vi.fn() }
})

const INACTIVE_DEAL: ClassRatePlanData = {
  id: 'crp_1',
  operatorId: 'op_1',
  classId: 'cls_kei',
  pickupLocationId: 'loc_namba',
  dayRateJpy: 6000,
  isActive: false,
  label: 'Kei Deal',
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
}

const SCOPE: OperatorScope = {
  pickedOperatorId: undefined,
  canWrite: true,
  showOperator: false,
  operatorNameById: new Map(),
}

function renderView() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={en}>
        <OperatorCombosView
          deals={[INACTIVE_DEAL]}
          classes={[{ id: 'cls_kei', name: 'Kei' }]}
          locations={[{ id: 'loc_namba', name: 'Namba' }]}
          scope={SCOPE}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('OperatorCombosView activate toggle', () => {
  afterEach(() => vi.mocked(updateComboDeal).mockReset())

  it('surfaces a Q-B publishability 400 from the activate toggle instead of silently swallowing it', async () => {
    // Activating a deal whose location was archived after creation 400s server-side
    // (assertPublishable). Without an onError surface the badge just never flips and
    // the operator gets no feedback — exactly the "it saved but nothing happened"
    // confusion Q-B exists to prevent.
    vi.mocked(updateComboDeal).mockRejectedValue(new ApiError('bad', 400, 'INVALID_LOCATION'))
    renderView()

    fireEvent.click(screen.getByRole('button', { name: 'Activate deal' }))

    await waitFor(() => expect(screen.getByText(COMBO.error.invalidLocation)).toBeInTheDocument())
    // The activate PATCH was attempted with isActive:true (the true->false toggle of an
    // inactive deal).
    expect(vi.mocked(updateComboDeal).mock.calls[0]?.[1]).toEqual({ isActive: true })
  })

  it('shows no error banner when the toggle succeeds', async () => {
    vi.mocked(updateComboDeal).mockResolvedValue({ ...INACTIVE_DEAL, isActive: true })
    renderView()

    fireEvent.click(screen.getByRole('button', { name: 'Activate deal' }))

    await waitFor(() => expect(vi.mocked(updateComboDeal)).toHaveBeenCalled())
    expect(screen.queryByText(COMBO.error.invalidLocation)).toBeNull()
  })
})
