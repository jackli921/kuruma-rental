import { AddInsuranceDialog } from '@/vite/operator-insurance/AddInsuranceDialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// csrfToken is supplied without a real auth flow; the merge under test is the
// dialog's, not the session's.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'test-csrf' } }),
}))

const SAVE = en.business.insurance.form.save
// #1437 slice 3: the single name input is now the en slot of a self-authored bundle.
const NAME_LABEL = en.business.insurance.form.nameEn

const createdRow = {
  id: 'ins1',
  operatorId: 'op_9',
  resolvedName: 'Full cover',
  nameI18n: { en: 'Full cover' },
  description: null,
  dailyPriceJpy: 0,
  deductibleJpy: null,
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

describe('AddInsuranceDialog create body scoping (P1a)', () => {
  it('merges the picked operatorId into the create POST body', async () => {
    renderDialog(<AddInsuranceDialog open onOpenChange={vi.fn()} pickedOperatorId="op_9" />)
    await submitWithName('Full cover')

    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/insurance-options')
    expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(postedBody()).toMatchObject({ nameI18n: { en: 'Full cover' }, operatorId: 'op_9' })
  })

  it('omits operatorId when no operator is picked (operator session auto-scopes)', async () => {
    renderDialog(<AddInsuranceDialog open onOpenChange={vi.fn()} />)
    await submitWithName('Full cover')

    expect(postedBody()).not.toHaveProperty('operatorId')
    expect(postedBody()).toMatchObject({ nameI18n: { en: 'Full cover' } })
  })
})
