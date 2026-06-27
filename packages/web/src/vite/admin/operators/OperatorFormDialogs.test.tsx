import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { OperatorCreateDialog } from './OperatorCreateDialog'
import { OperatorEditDialog } from './OperatorEditDialog'

const CREATE = en.admin.operators.createDialog
const EDIT = en.admin.operators.editDialog

function withIntl(node: ReactNode) {
  return render(
    <IntlProvider locale="en" messages={en}>
      {node}
    </IntlProvider>,
  )
}

describe('OperatorCreateDialog', () => {
  it('keeps submit disabled until a name is entered, then submits name only', () => {
    const onSubmit = vi.fn()
    withIntl(
      <OperatorCreateDialog
        open
        onOpenChange={vi.fn()}
        isPending={false}
        error={null}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByRole('button', { name: CREATE.submit })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText(CREATE.nameLabel), { target: { value: 'New Op' } })
    fireEvent.click(screen.getByRole('button', { name: CREATE.submit }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'New Op' })
  })

  it('includes the pre-auth handoff URL only when one is provided', () => {
    const onSubmit = vi.fn()
    withIntl(
      <OperatorCreateDialog
        open
        onOpenChange={vi.fn()}
        isPending={false}
        error={null}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.change(screen.getByLabelText(CREATE.nameLabel), { target: { value: 'New Op' } })
    fireEvent.change(screen.getByLabelText(CREATE.handoffLabel), {
      target: { value: 'https://handoff.example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: CREATE.submit }))
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'New Op',
      preAuthHandoffUrl: 'https://handoff.example.com',
    })
  })
})

describe('OperatorEditDialog', () => {
  const operator = { id: 'op_1', name: 'Kanata Cars' }

  it('prefills the current name and submits the edited value', () => {
    const onSubmit = vi.fn()
    withIntl(
      <OperatorEditDialog
        open
        onOpenChange={vi.fn()}
        operator={operator}
        isPending={false}
        error={null}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByDisplayValue('Kanata Cars')).not.toBeNull()
    fireEvent.change(screen.getByLabelText(EDIT.nameLabel), { target: { value: 'Kanata Rentals' } })
    fireEvent.click(screen.getByRole('button', { name: EDIT.submit }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Kanata Rentals' })
  })
})
