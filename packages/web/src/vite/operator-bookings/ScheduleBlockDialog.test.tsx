import { ApiError } from '@/lib/api-error'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { ScheduleBlockDialog } from './ScheduleBlockDialog'
import { OPERATOR_BOOKINGS_KEY } from './api'

// #1101 Slice B B5: the create-block dialog. Mock only the write fn — OPERATOR_BOOKINGS_KEY
// and the shared types stay real so the invalidation target is the production key.
const createBlockMock = vi.hoisted(() => vi.fn())
vi.mock('./api', async (orig) => {
  const actual = await orig<typeof import('./api')>()
  return { ...actual, createBlock: createBlockMock }
})

const T = en.bookings.operator.blocks.schedule

const VEHICLES = [
  { id: 'veh-1', name: 'Prius' },
  { id: 'veh-2', name: 'Note' },
]

const CREATED = {
  id: 'blk-1',
  vehicleId: 'veh-2',
  startAt: '2026-07-01T00:00:00.000Z',
  endAt: '2026-07-02T00:00:00.000Z',
  kind: 'MAINTENANCE' as const,
  reason: 'Oil change',
  notes: null,
}

afterEach(() => createBlockMock.mockReset())

type Props = Parameters<typeof ScheduleBlockDialog>[0]

function setup(over: Partial<Props> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={en}>
        <ScheduleBlockDialog
          open
          onOpenChange={onOpenChange}
          vehicles={VEHICLES}
          csrfToken="csrf-1"
          {...over}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, invalidate }
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(T.startLabel), { target: { value: '2026-07-01T09:00' } })
  fireEvent.change(screen.getByLabelText(T.endLabel), { target: { value: '2026-07-02T09:00' } })
  fireEvent.change(screen.getByLabelText(T.reasonLabel), { target: { value: 'Oil change' } })
}

describe('ScheduleBlockDialog', () => {
  it('defaults the vehicle picker to the clicked slot vehicle (review #2)', () => {
    setup({ initialVehicleId: 'veh-2' })
    expect((screen.getByLabelText(T.vehicleLabel) as HTMLSelectElement).value).toBe('veh-2')
  })

  it('falls back to the first vehicle when no slot vehicle is supplied', () => {
    setup()
    expect((screen.getByLabelText(T.vehicleLabel) as HTMLSelectElement).value).toBe('veh-1')
  })

  it('creates the block (JST→ISO), invalidates the operator-bookings cache, and closes on success', async () => {
    createBlockMock.mockResolvedValue(CREATED)
    const { onOpenChange, invalidate } = setup({ initialVehicleId: 'veh-2' })

    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: T.submit }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    // 09:00 JST is 00:00Z (Tokyo is UTC+9, no DST); blank notes are omitted, not sent as ''.
    expect(createBlockMock).toHaveBeenCalledWith(
      'veh-2',
      {
        kind: 'MAINTENANCE',
        reason: 'Oil change',
        startAt: '2026-07-01T00:00:00.000Z',
        endAt: '2026-07-02T00:00:00.000Z',
      },
      'csrf-1',
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: OPERATOR_BOOKINGS_KEY })
  })

  it('surfaces a 409 as the overlap message and keeps the dialog open', async () => {
    createBlockMock.mockRejectedValue(new ApiError('overlap', 409))
    const { onOpenChange } = setup()

    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: T.submit }))

    expect(await screen.findByText(T.overlapError)).not.toBeNull()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('keeps submit disabled until vehicle, window, and reason are all present', () => {
    setup()
    const submit = screen.getByRole('button', { name: T.submit }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fillRequiredFields()
    expect(submit.disabled).toBe(false)
  })
})
