import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { AddAddOnDialog } from './AddAddOnDialog'

// csrfToken is supplied without a real auth flow; the merge under test is the
// dialog's, not the session's.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'test-csrf' } }),
}))

const SAVE = en.business.addOns.form.save
const NAME_LABEL = en.business.addOns.form.name

const createdRow = {
  id: 'a1',
  operatorId: 'op_9',
  name: 'Child seat',
  description: null,
  priceJpy: 0,
  status: 'ACTIVE',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

const fetchSpy = vi.spyOn(globalThis, 'fetch')
afterEach(() => fetchSpy.mockReset())

function renderDialog(node: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en}>
        {node}
      </IntlProvider>
    </QueryClientProvider>,
  )
}

async function submitWithName(name: string) {
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: createdRow }), { status: 200 }),
  )
  fireEvent.change(screen.getByLabelText(NAME_LABEL), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: SAVE }))
  await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
}

function postedBody(): Record<string, unknown> {
  const init = fetchSpy.mock.calls[0]?.[1]
  return JSON.parse(String(init?.body))
}

describe('AddAddOnDialog create body scoping (P1a)', () => {
  it('merges the picked operatorId into the create POST body', async () => {
    renderDialog(<AddAddOnDialog open onOpenChange={vi.fn()} pickedOperatorId="op_9" />)
    await submitWithName('Child seat')

    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/add-ons')
    expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(postedBody()).toMatchObject({ name: 'Child seat', operatorId: 'op_9' })
  })

  it('omits operatorId when no operator is picked (operator session auto-scopes)', async () => {
    renderDialog(<AddAddOnDialog open onOpenChange={vi.fn()} />)
    await submitWithName('Child seat')

    expect(postedBody()).not.toHaveProperty('operatorId')
    expect(postedBody()).toMatchObject({ name: 'Child seat' })
  })
})
