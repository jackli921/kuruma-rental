import type { BookingDto } from '@/vite/bookings/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { ManualBookingDialog } from './ManualBookingDialog'
import type { CalendarVehicle } from './api'

// Mock only createManualBooking so we can assert its args; keep the rest of the api
// module real (invalidateBookingCaches runs in onSuccess).
vi.mock('@/vite/operator-bookings/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/vite/operator-bookings/api')>()),
  createManualBooking: vi.fn(),
}))

import { createManualBooking } from '@/vite/operator-bookings/api'

function renderDialog(pickedOperatorId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
  return render(
    <ManualBookingDialog
      open
      onOpenChange={() => {}}
      vehicles={[{ id: 'v1', name: 'Aqua' } as CalendarVehicle]}
      locations={[{ id: 'l1', name: 'Namba' }]}
      csrfToken="csrf-1"
      pickedOperatorId={pickedOperatorId}
    />,
    { wrapper },
  )
}

// The default customer mode is walk-in, so no CustomerPicker/search is needed.
function fillWalkInAndSubmit() {
  fireEvent.change(document.getElementById('manual-start') as HTMLInputElement, {
    target: { value: '2026-08-01T10:00' },
  })
  fireEvent.change(document.getElementById('manual-end') as HTMLInputElement, {
    target: { value: '2026-08-02T10:00' },
  })
  fireEvent.change(document.getElementById('manual-name') as HTMLInputElement, {
    target: { value: 'Taro' },
  })
  fireEvent.change(document.getElementById('manual-phone') as HTMLInputElement, {
    target: { value: '+81-90-1111-2222' },
  })
  fireEvent.click(screen.getByRole('button', { name: en.bookings.operator.newBooking.submit }))
}

describe('ManualBookingDialog — #1260 picker-operator binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createManualBooking).mockResolvedValue({ id: 'b1' } as BookingDto)
  })

  it('forwards pickedOperatorId to createManualBooking on submit', async () => {
    renderDialog('op-7')
    fillWalkInAndSubmit()
    await waitFor(() => expect(createManualBooking).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createManualBooking).mock.calls[0]?.[2]).toBe('op-7')
  })

  it('passes undefined for a tenant operator session (no pick)', async () => {
    renderDialog(undefined)
    fillWalkInAndSubmit()
    await waitFor(() => expect(createManualBooking).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createManualBooking).mock.calls[0]?.[2]).toBeUndefined()
  })
})
