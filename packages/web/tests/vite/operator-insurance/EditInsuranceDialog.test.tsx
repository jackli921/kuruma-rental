import { EditInsuranceDialog } from '@/vite/operator-insurance/EditInsuranceDialog'
import type { InsuranceOptionData } from '@kuruma/shared/types/insurance-option'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'test-csrf' } }),
}))

const NAME_EN = en.business.insurance.form.nameEn
const NAME_JA = en.business.insurance.form.nameJa
const NAME_ZH = en.business.insurance.form.nameZh
const SAVE = en.business.insurance.form.save

const baseRow: InsuranceOptionData = {
  id: 'ins_1',
  operatorId: 'op_1',
  resolvedName: 'Full cover',
  nameI18n: null,
  description: null,
  dailyPriceJpy: 2000,
  deductibleJpy: null,
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
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

describe('EditInsuranceDialog prefill (#1437 Finding 8)', () => {
  it('prefills all three name slots from a self-authored nameI18n bundle', () => {
    const option = {
      ...baseRow,
      resolvedName: 'Full cover',
      nameI18n: { en: 'Full cover', ja: 'フルカバー', zh: '全保' },
    }
    renderDialog(<EditInsuranceDialog option={option} onOpenChange={vi.fn()} />)

    expect(screen.getByLabelText(NAME_EN)).toHaveValue('Full cover')
    expect(screen.getByLabelText(NAME_JA)).toHaveValue('フルカバー')
    expect(screen.getByLabelText(NAME_ZH)).toHaveValue('全保')
  })

  it('seeds the English slot from the resolved name for a legacy row (nameI18n null)', () => {
    const option = { ...baseRow, resolvedName: 'Legacy Cover', nameI18n: null }
    renderDialog(<EditInsuranceDialog option={option} onOpenChange={vi.fn()} />)

    // A price-only edit must not force re-typing the name — en falls back to resolvedName.
    expect(screen.getByLabelText(NAME_EN)).toHaveValue('Legacy Cover')
    expect(screen.getByLabelText(NAME_JA)).toHaveValue('')
    expect(screen.getByLabelText(NAME_ZH)).toHaveValue('')
  })

  it('submits the edited slots as a nameI18n bundle to the PATCH', async () => {
    const option = { ...baseRow, resolvedName: 'Full cover', nameI18n: { en: 'Full cover' } }
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { ...option, nameI18n: { en: 'Full cover', ja: '追加保険' } },
        }),
        {
          status: 200,
        },
      ),
    )
    renderDialog(<EditInsuranceDialog option={option} onOpenChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(NAME_JA), { target: { value: '追加保険' } })
    fireEvent.click(screen.getByRole('button', { name: SAVE }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const init = fetchSpy.mock.calls[0]?.[1]
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      nameI18n: { en: 'Full cover', ja: '追加保険' },
    })
  })
})
