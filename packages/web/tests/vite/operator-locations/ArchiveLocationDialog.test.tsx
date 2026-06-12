import { ApiError } from '@/lib/api-error'
import { ArchiveLocationDialog } from '@/vite/operator-locations/ArchiveLocationDialog'
import * as api from '@/vite/operator-locations/api'
import { LOCATIONS_QUERY_KEY, type OperatorLocation } from '@/vite/operator-locations/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

vi.mock('@/vite/operator-locations/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-locations/api')>()
  return { ...actual, archiveLocation: vi.fn() }
})

const archiveLocation = vi.mocked(api.archiveLocation)
const en = enMessages.business.locations

function location(overrides: Partial<OperatorLocation> = {}): OperatorLocation {
  return {
    id: 'loc_1',
    operatorId: 'op_1',
    name: 'Namba Branch',
    address: '1-2-3 Namba, Chuo-ku, Osaka',
    operatingHours: null,
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderDialog(loc: OperatorLocation | null) {
  const onOpenChange = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={enMessages}>
        <ArchiveLocationDialog location={loc} onOpenChange={onOpenChange} />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, invalidateSpy }
}

describe('ArchiveLocationDialog', () => {
  afterEach(() => {
    cleanup()
    archiveLocation.mockReset()
  })

  it('archives by id, invalidates the list, and closes', async () => {
    archiveLocation.mockResolvedValue({ id: 'loc_1', status: 'ARCHIVED' } as never)
    const user = userEvent.setup()
    const { onOpenChange, invalidateSpy } = renderDialog(location())

    await user.click(screen.getByRole('button', { name: en.archiveConfirm }))

    // React Query v5 passes a context object as the 2nd mutationFn arg, so assert
    // the first positional rather than the whole call shape.
    await waitFor(() => expect(archiveLocation).toHaveBeenCalledTimes(1))
    expect(archiveLocation.mock.calls[0][0]).toBe('loc_1')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: LOCATIONS_QUERY_KEY })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('surfaces the active-bookings count and keeps the dialog open', async () => {
    archiveLocation.mockRejectedValue(new api.LocationArchiveBlockedError(2))
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog(location())

    await user.click(screen.getByRole('button', { name: en.archiveConfirm }))

    expect(await screen.findByText(/2 active bookings/)).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('surfaces a generic failure message inline', async () => {
    archiveLocation.mockRejectedValue(new ApiError('Location not found', 404))
    const user = userEvent.setup()
    renderDialog(location())

    await user.click(screen.getByRole('button', { name: en.archiveConfirm }))

    expect(await screen.findByText('Location not found')).toBeInTheDocument()
  })
})
