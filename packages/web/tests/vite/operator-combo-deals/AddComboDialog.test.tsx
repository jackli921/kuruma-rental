import { ApiError } from '@/lib/api-error'
import { AddComboDialog, comboErrorMessage } from '@/vite/operator-combo-deals/AddComboDialog'
import { COMBO_QUERY_KEY, createComboDeal } from '@/vite/operator-combo-deals/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const COMBO = en.business.comboDeals

// The dialog reads the CSRF token from the session and POSTs via createComboDeal;
// both are stubbed so the test asserts the wiring (what is sent, what is
// invalidated), not real network I/O.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'csrf_1' } }),
}))
vi.mock('@/vite/operator-combo-deals/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-combo-deals/api')>()
  return { ...actual, createComboDeal: vi.fn() }
})

// The real ComboForm drives a base-ui Select (portal-rendered, unfriendly to
// jsdom). Stub it to a single button that submits fixed, valid values so this
// test targets the DIALOG wiring — the mutation, the invalidation, the close —
// rather than the picker internals (those are the form's own concern).
const VALID_INPUT = {
  classId: '11111111-1111-1111-1111-111111111111',
  pickupLocationId: '22222222-2222-2222-2222-222222222222',
  dayRateJpy: 6000,
  label: 'Kei Deal',
  isActive: true,
}
vi.mock('@/vite/operator-combo-deals/ComboForm', () => ({
  // Swallow the submit rejection the way react-hook-form's handleSubmit does, so
  // a rejected mutation surfaces via the dialog's error state (not as an unhandled
  // rejection that fails the run).
  ComboForm: ({ onSubmit }: { onSubmit: (d: typeof VALID_INPUT) => Promise<void> }) => (
    <button
      type="button"
      onClick={() => {
        onSubmit(VALID_INPUT).catch(() => {})
      }}
    >
      submit-combo
    </button>
  ),
}))

function renderDialog(pickedOperatorId?: string) {
  const onOpenChange = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
  render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={en}>
        <AddComboDialog
          open
          onOpenChange={onOpenChange}
          classes={[]}
          locations={[]}
          pickedOperatorId={pickedOperatorId}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, invalidateSpy }
}

describe('AddComboDialog', () => {
  afterEach(() => {
    vi.mocked(createComboDeal).mockReset()
  })

  it('creates the deal, invalidates the combo query key, and closes on success', async () => {
    vi.mocked(createComboDeal).mockResolvedValue({
      ...VALID_INPUT,
      id: 'crp_new',
      operatorId: 'op_1',
      label: 'Kei Deal',
      createdAt: 'x',
      updatedAt: 'y',
    })
    const { onOpenChange, invalidateSpy } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'submit-combo' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    // Operator session: no operatorId stamped into the body; CSRF token threaded.
    expect(vi.mocked(createComboDeal).mock.calls[0]?.[0]).toEqual(VALID_INPUT)
    expect(vi.mocked(createComboDeal).mock.calls[0]?.[1]).toBe('csrf_1')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: COMBO_QUERY_KEY })
  })

  it('stamps the picked operatorId into the create body for a picker admin', async () => {
    vi.mocked(createComboDeal).mockResolvedValue({
      ...VALID_INPUT,
      id: 'crp_new',
      operatorId: 'op_picked',
      label: 'Kei Deal',
      createdAt: 'x',
      updatedAt: 'y',
    })
    renderDialog('op_picked')

    fireEvent.click(screen.getByRole('button', { name: 'submit-combo' }))

    await waitFor(() =>
      expect(vi.mocked(createComboDeal).mock.calls[0]?.[0]).toEqual({
        ...VALID_INPUT,
        operatorId: 'op_picked',
      }),
    )
  })

  it('surfaces the duplicate-scope 409 as the "already exists" banner and does not close', async () => {
    vi.mocked(createComboDeal).mockRejectedValue(new ApiError('conflict', 409))
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'submit-combo' }))

    await waitFor(() => expect(screen.getByText(COMBO.error.duplicate)).toBeInTheDocument())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('surfaces INVALID_LOCATION with the location-specific message', async () => {
    vi.mocked(createComboDeal).mockRejectedValue(new ApiError('bad', 400, 'INVALID_LOCATION'))
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'submit-combo' }))

    await waitFor(() => expect(screen.getByText(COMBO.error.invalidLocation)).toBeInTheDocument())
  })
})

// Pure mapping — no render — so the error-code taxonomy is pinned mutation-resistantly.
describe('comboErrorMessage', () => {
  const t = (key: string) => key

  it('maps each API failure to its distinct copy by code/status', () => {
    expect(comboErrorMessage(new ApiError('x', 400, 'INVALID_VEHICLE_CLASS'), t)).toBe(
      'error.invalidClass',
    )
    expect(comboErrorMessage(new ApiError('x', 400, 'INVALID_LOCATION'), t)).toBe(
      'error.invalidLocation',
    )
    expect(comboErrorMessage(new ApiError('x', 409), t)).toBe('error.duplicate')
    // An unmapped ApiError falls through to its own message.
    expect(comboErrorMessage(new ApiError('boom', 500), t)).toBe('boom')
    // A non-ApiError still yields a string.
    expect(comboErrorMessage(new Error('plain'), t)).toBe('plain')
  })
})
