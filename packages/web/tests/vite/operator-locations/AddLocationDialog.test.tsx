import { ApiError } from '@/lib/api-error'
import { AddLocationDialog } from '@/vite/operator-locations/AddLocationDialog'
import * as api from '@/vite/operator-locations/api'
import { LOCATIONS_QUERY_KEY } from '@/vite/operator-locations/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// csrfToken is supplied without a real auth flow; the dialog must thread it into
// the create call so the csrf() middleware admits the cookie write.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'test-csrf' } }),
}))

// Stub only the write path; keep LOCATIONS_QUERY_KEY and the query options real.
vi.mock('@/vite/operator-locations/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-locations/api')>()
  return { ...actual, createLocation: vi.fn() }
})

const createLocation = vi.mocked(api.createLocation)
const en = enMessages.business.locations

function renderDialog(pickedOperatorId?: string) {
  const onOpenChange = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={enMessages}>
        <AddLocationDialog open onOpenChange={onOpenChange} pickedOperatorId={pickedOperatorId} />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, invalidateSpy }
}

describe('AddLocationDialog', () => {
  afterEach(() => {
    cleanup()
    createLocation.mockReset()
  })

  it('submits the entered name and address with form defaults, invalidates the list, and closes', async () => {
    createLocation.mockResolvedValue({ id: 'loc_new' } as never)
    const user = userEvent.setup()
    const { onOpenChange, invalidateSpy } = renderDialog()

    await user.type(screen.getByLabelText(en.form.name), 'Namba Branch')
    await user.type(screen.getByLabelText(en.form.address), '1-2-3 Namba, Chuo-ku, Osaka')
    await user.click(screen.getByRole('button', { name: en.form.save }))

    await waitFor(() => expect(createLocation).toHaveBeenCalledTimes(1))
    expect(createLocation.mock.calls[0][0]).toMatchObject({
      name: 'Namba Branch',
      address: '1-2-3 Namba, Chuo-ku, Osaka',
      operatingHours: null,
      timezone: 'Asia/Tokyo',
      defaultTurnaroundMinutes: 2880,
    })
    // The session's CSRF token is threaded as the 2nd arg, or the csrf() middleware
    // would 403 the cookie write.
    expect(createLocation.mock.calls[0][1]).toBe('test-csrf')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: LOCATIONS_QUERY_KEY })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('merges the picked operatorId into the create body when an admin picked a tenant (P1a)', async () => {
    createLocation.mockResolvedValue({ id: 'loc_new' } as never)
    const user = userEvent.setup()
    renderDialog('op_9')

    await user.type(screen.getByLabelText(en.form.name), 'Namba Branch')
    await user.type(screen.getByLabelText(en.form.address), '1-2-3 Namba, Chuo-ku, Osaka')
    await user.click(screen.getByRole('button', { name: en.form.save }))

    await waitFor(() => expect(createLocation).toHaveBeenCalledTimes(1))
    expect(createLocation.mock.calls[0][0]).toMatchObject({
      name: 'Namba Branch',
      operatorId: 'op_9',
    })
  })

  it('omits operatorId when no operator is picked (operator session auto-scopes) (P1a)', async () => {
    createLocation.mockResolvedValue({ id: 'loc_new' } as never)
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText(en.form.name), 'Namba Branch')
    await user.type(screen.getByLabelText(en.form.address), '1-2-3 Namba, Chuo-ku, Osaka')
    await user.click(screen.getByRole('button', { name: en.form.save }))

    await waitFor(() => expect(createLocation).toHaveBeenCalledTimes(1))
    expect(createLocation.mock.calls[0][0]).not.toHaveProperty('operatorId')
    expect(createLocation.mock.calls[0][0]).toMatchObject({ name: 'Namba Branch' })
  })

  it('surfaces a duplicate-name 409 inline and keeps the dialog open', async () => {
    createLocation.mockRejectedValue(new ApiError('A location with this name already exists', 409))
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog()

    await user.type(screen.getByLabelText(en.form.name), 'Namba Branch')
    await user.type(screen.getByLabelText(en.form.address), '1-2-3 Namba, Chuo-ku, Osaka')
    await user.click(screen.getByRole('button', { name: en.form.save }))

    expect(await screen.findByText('A location with this name already exists')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
