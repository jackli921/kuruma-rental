import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import { OperatorAddOnsView } from './OperatorAddOnsView'
import type { AddOnData } from './api'

const ADD_BUTTON = en.business.addOns.addOption

const row: AddOnData = {
  id: 'a1',
  operatorId: 'op_1',
  name: 'Child seat',
  description: null,
  priceJpy: 3000,
  status: 'ACTIVE',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

type ViewProps = Parameters<typeof OperatorAddOnsView>[0]

function renderView(over: Partial<ViewProps>) {
  const props: ViewProps = {
    addOns: [row],
    canWrite: false,
    showOperator: false,
    operatorNameById: new Map(),
    ...over,
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en}>
        <OperatorAddOnsView {...props} />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('OperatorAddOnsView', () => {
  it('all-mode: shows the operator label and hides the Add button (read-only)', () => {
    renderView({
      canWrite: false,
      showOperator: true,
      operatorNameById: new Map([['op_1', 'Sakura']]),
    })
    expect(screen.getByText('Sakura')).toBeTruthy()
    expect(screen.queryByRole('button', { name: ADD_BUTTON })).toBeNull()
  })

  it('scoped-write mode: shows the Add button and no operator label', () => {
    renderView({
      canWrite: true,
      showOperator: false,
      operatorNameById: new Map(),
      pickedOperatorId: 'op_9',
    })
    expect(screen.getByRole('button', { name: ADD_BUTTON })).toBeTruthy()
    expect(screen.queryByText('Sakura')).toBeNull()
  })
})
