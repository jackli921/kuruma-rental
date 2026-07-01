import { BulkActionBar } from '@/vite/operator-fleet/BulkActionBar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// The bar reads the CSRF token from the session and echoes it on the bulk write
// (#1304); mock a fixed token so the assertions can pin it.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'test-csrf' } }),
}))

// Mock the api module so the bar never hits the network. We assert the exact
// (ids, status, csrf) tuple the bar forwards to bulkUpdateVehicleStatus.
const bulkUpdateVehicleStatus = vi.fn()
vi.mock('@/vite/operator-fleet/api', async () => {
  const actual = await vi.importActual<typeof import('@/vite/operator-fleet/api')>(
    '@/vite/operator-fleet/api',
  )
  return {
    ...actual,
    bulkUpdateVehicleStatus: (...args: unknown[]) => bulkUpdateVehicleStatus(...args),
  }
})

const bulk = en.business.vehicles.bulk

function renderBar(props: {
  selectedIds: string[]
  onDone?: () => void
  onClear?: () => void
}): { onDone: ReturnType<typeof vi.fn>; onClear: ReturnType<typeof vi.fn> } & ReturnType<
  typeof render
> {
  const onDone = vi.fn()
  const onClear = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        <BulkActionBar
          selectedIds={props.selectedIds}
          onDone={props.onDone ?? onDone}
          onClear={props.onClear ?? onClear}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { ...result, onDone, onClear }
}

afterEach(() => {
  bulkUpdateVehicleStatus.mockReset()
})

describe('BulkActionBar', () => {
  it('renders nothing when the selection is empty', () => {
    const { container } = renderBar({ selectedIds: [] })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the selected count for the given ids', () => {
    renderBar({ selectedIds: ['a', 'b', 'c'] })
    expect(screen.getByText('3 vehicles selected')).toBeInTheDocument()
  })

  it('set maintenance: confirm calls bulkUpdateVehicleStatus(ids, MAINTENANCE) then onDone', async () => {
    bulkUpdateVehicleStatus.mockResolvedValue([])
    const user = userEvent.setup()
    const { onDone } = renderBar({ selectedIds: ['v1', 'v2'] })

    await user.click(screen.getByRole('button', { name: bulk.setMaintenance }))
    // Confirm dialog appears with its title before anything is applied.
    expect(screen.getByText(bulk.confirmTitle)).toBeInTheDocument()
    expect(bulkUpdateVehicleStatus).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: en.business.vehicles.form.confirm }))

    await waitFor(() =>
      expect(bulkUpdateVehicleStatus).toHaveBeenCalledWith(
        ['v1', 'v2'],
        'MAINTENANCE',
        'test-csrf',
      ),
    )
    expect(bulkUpdateVehicleStatus).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })

  it('set available: confirm calls bulkUpdateVehicleStatus(ids, AVAILABLE)', async () => {
    bulkUpdateVehicleStatus.mockResolvedValue([])
    const user = userEvent.setup()
    const { onDone } = renderBar({ selectedIds: ['x'] })

    await user.click(screen.getByRole('button', { name: bulk.setAvailable }))
    await user.click(screen.getByRole('button', { name: en.business.vehicles.form.confirm }))

    await waitFor(() =>
      expect(bulkUpdateVehicleStatus).toHaveBeenCalledWith(['x'], 'AVAILABLE', 'test-csrf'),
    )
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })

  it('clear selection calls onClear without mutating', async () => {
    const user = userEvent.setup()
    const { onClear } = renderBar({ selectedIds: ['v1'] })

    await user.click(screen.getByRole('button', { name: bulk.deselectAll }))

    expect(onClear).toHaveBeenCalledTimes(1)
    expect(bulkUpdateVehicleStatus).not.toHaveBeenCalled()
  })

  it('surfaces the error inline and does not call onDone when the mutation fails', async () => {
    bulkUpdateVehicleStatus.mockRejectedValue(new Error('Bulk update failed'))
    const user = userEvent.setup()
    const { onDone } = renderBar({ selectedIds: ['v1'] })

    await user.click(screen.getByRole('button', { name: bulk.setMaintenance }))
    await user.click(screen.getByRole('button', { name: en.business.vehicles.form.confirm }))

    expect(await screen.findByText('Bulk update failed')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })
})
