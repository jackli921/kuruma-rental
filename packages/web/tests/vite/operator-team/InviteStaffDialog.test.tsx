import { InviteStaffDialog } from '@/vite/operator-team/InviteStaffDialog'
import * as api from '@/vite/operator-team/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

vi.mock('@/vite/operator-team/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-team/api')>()
  return { ...actual, inviteStaff: vi.fn() }
})

const inviteStaff = vi.mocked(api.inviteStaff)
const en = enMessages.business.team

function renderDialog() {
  const onOpenChange = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={enMessages}>
        <InviteStaffDialog
          open
          onOpenChange={onOpenChange}
          csrfToken="csrf-token"
          operatorId="op_1"
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange }
}

describe('InviteStaffDialog', () => {
  afterEach(() => {
    cleanup()
    inviteStaff.mockReset()
  })

  it('mints the invite with the email, csrf token, AND the operatorId (picker path)', async () => {
    inviteStaff.mockResolvedValue({
      inviteUrl: 'https://app/provider/invite/tok',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText(en.form.email), 'new@op1.com')
    await user.click(screen.getByRole('button', { name: en.form.submit }))

    await waitFor(() => expect(inviteStaff).toHaveBeenCalledTimes(1))
    expect(inviteStaff.mock.calls[0]).toEqual([{ email: 'new@op1.com' }, 'csrf-token', 'op_1'])
  })
})
