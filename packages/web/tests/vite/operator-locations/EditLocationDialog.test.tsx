import { ApiError } from '@/lib/api-error'
import { EditLocationDialog } from '@/vite/operator-locations/EditLocationDialog'
import * as api from '@/vite/operator-locations/api'
import { LOCATIONS_QUERY_KEY, type OperatorLocation } from '@/vite/operator-locations/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// csrfToken is supplied without a real auth flow; the dialog must thread it into
// the update call so the csrf() middleware admits the cookie write.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'test-csrf' } }),
}))

vi.mock('@/vite/operator-locations/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-locations/api')>()
  return { ...actual, updateLocation: vi.fn() }
})

const updateLocation = vi.mocked(api.updateLocation)
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
        <EditLocationDialog location={loc} onOpenChange={onOpenChange} />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, invalidateSpy }
}

describe('EditLocationDialog', () => {
  afterEach(() => {
    cleanup()
    updateLocation.mockReset()
  })

  it('prefills the form with the location current values', () => {
    renderDialog(location())
    expect(screen.getByLabelText(en.form.name)).toHaveValue('Namba Branch')
    expect(screen.getByLabelText(en.form.address)).toHaveValue('1-2-3 Namba, Chuo-ku, Osaka')
  })

  it('patches the edited name, invalidates the list, and closes', async () => {
    updateLocation.mockResolvedValue({ id: 'loc_1' } as never)
    const user = userEvent.setup()
    const { onOpenChange, invalidateSpy } = renderDialog(location())

    const nameInput = screen.getByLabelText(en.form.name)
    await user.clear(nameInput)
    await user.type(nameInput, 'Namba Annex')
    await user.click(screen.getByRole('button', { name: en.form.save }))

    await waitFor(() => expect(updateLocation).toHaveBeenCalledTimes(1))
    expect(updateLocation.mock.calls[0][0]).toBe('loc_1')
    expect(updateLocation.mock.calls[0][1]).toMatchObject({ name: 'Namba Annex' })
    // The session's CSRF token is threaded as the 3rd arg (id, body, token).
    expect(updateLocation.mock.calls[0][2]).toBe('test-csrf')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: LOCATIONS_QUERY_KEY })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('surfaces a server error inline and keeps the dialog open', async () => {
    updateLocation.mockRejectedValue(new ApiError('A location with this name already exists', 409))
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog(location())

    await user.click(screen.getByRole('button', { name: en.form.save }))

    expect(await screen.findByText('A location with this name already exists')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
