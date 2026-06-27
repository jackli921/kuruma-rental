import type { OperatorScope } from '@/vite/operator-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import { OperatorAddOnsView } from './OperatorAddOnsView'
import type { AddOnData } from './api'

const ADD_BUTTON = en.business.addOns.addOption
const EDIT_ACTION = en.business.addOns.editOption
const ARCHIVE_ACTION = en.business.addOns.archiveAction

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

function scope(over: Partial<OperatorScope> = {}): OperatorScope {
  return {
    pickedOperatorId: undefined,
    canWrite: false,
    showOperator: false,
    operatorNameById: new Map(),
    ...over,
  }
}

function renderView(scopeValue: OperatorScope, addOns: readonly AddOnData[] = [row]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en}>
        <OperatorAddOnsView addOns={addOns} scope={scopeValue} />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('OperatorAddOnsView', () => {
  it('all-mode: shows the operator label and hides the Add button (read-only)', () => {
    renderView(scope({ showOperator: true, operatorNameById: new Map([['op_1', 'Sakura']]) }))
    expect(screen.getByText('Sakura')).toBeTruthy()
    expect(screen.queryByRole('button', { name: ADD_BUTTON })).toBeNull()
  })

  it('scoped-write mode: shows the Add button and no operator label', () => {
    renderView(scope({ canWrite: true, pickedOperatorId: 'op_9' }))
    expect(screen.getByRole('button', { name: ADD_BUTTON })).toBeTruthy()
    expect(screen.queryByText('Sakura')).toBeNull()
  })

  it('read-only mode hides the per-row Edit/Archive affordances', () => {
    renderView(scope({ canWrite: false }))
    expect(screen.queryByRole('button', { name: EDIT_ACTION })).toBeNull()
    expect(screen.queryByRole('button', { name: ARCHIVE_ACTION })).toBeNull()
  })

  it('scoped-write mode exposes the per-row Edit/Archive affordances', () => {
    renderView(scope({ canWrite: true, pickedOperatorId: 'op_9' }))
    expect(screen.getByRole('button', { name: EDIT_ACTION })).toBeTruthy()
    expect(screen.getByRole('button', { name: ARCHIVE_ACTION })).toBeTruthy()
  })
})
