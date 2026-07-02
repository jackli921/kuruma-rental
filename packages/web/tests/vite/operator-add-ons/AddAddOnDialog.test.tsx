import { AddAddOnDialog } from '@/vite/operator-add-ons/AddAddOnDialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// csrfToken is supplied without a real auth flow; the mapping under test is the
// dialog's (picked template + operatorId scope), not the session's.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'test-csrf' } }),
}))

const SAVE = en.business.addOns.form.save
const TEMPLATE_LABEL = en.business.addOns.form.template

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111'
const templates = [{ id: TEMPLATE_ID, key: 'child_seat', resolvedName: 'Child seat' }]

const createdRow = {
  id: 'a1',
  operatorId: 'op_9',
  templateId: TEMPLATE_ID,
  resolvedName: 'Child seat',
  resolvedDescription: null,
  descriptionOverride: null,
  priceJpy: 0,
  status: 'ACTIVE',
}

const fetchSpy = vi.spyOn(globalThis, 'fetch')
afterEach(() => fetchSpy.mockReset())

// Templates load on open (a GET) and the create is a POST; dispatch by URL so both
// the picker query and the mutation receive a valid envelope.
function stubFetch() {
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    const body = String(input).includes('/add-on-templates')
      ? { success: true, data: templates }
      : { success: true, data: createdRow }
    return new Response(JSON.stringify(body), { status: 200 })
  })
}

function renderDialog(node: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en}>
        {node}
      </IntlProvider>
    </QueryClientProvider>,
  )
}

async function pickTemplateAndSave() {
  const user = userEvent.setup()
  // Wait for the picker to populate from the templates fetch, then choose one.
  await waitFor(() => expect(screen.getByLabelText(TEMPLATE_LABEL)).toHaveTextContent('Child seat'))
  await user.selectOptions(screen.getByLabelText(TEMPLATE_LABEL), TEMPLATE_ID)
  await user.click(screen.getByRole('button', { name: SAVE }))
}

function postBody(): Record<string, unknown> {
  const call = fetchSpy.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
  )
  return JSON.parse(String((call?.[1] as RequestInit).body))
}

describe('AddAddOnDialog create body scoping (P1a)', () => {
  it('POSTs the picked templateId and merges the picked operatorId', async () => {
    stubFetch()
    renderDialog(<AddAddOnDialog open onOpenChange={vi.fn()} pickedOperatorId="op_9" />)
    await pickTemplateAndSave()

    await waitFor(() =>
      expect(postBody()).toMatchObject({ templateId: TEMPLATE_ID, operatorId: 'op_9' }),
    )
  })

  it('omits operatorId when no operator is picked (operator session auto-scopes)', async () => {
    stubFetch()
    renderDialog(<AddAddOnDialog open onOpenChange={vi.fn()} />)
    await pickTemplateAndSave()

    await waitFor(() => {
      expect(postBody()).toMatchObject({ templateId: TEMPLATE_ID })
      expect(postBody()).not.toHaveProperty('operatorId')
    })
  })
})
