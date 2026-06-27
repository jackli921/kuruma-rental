import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { IntlProvider } from 'use-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { OperatorContextPicker } from './OperatorContextPicker'

// Mock the route seam so the picker is exercised as pure presentation: the clear
// reducer lives in useSetOperatorContext (tested in operator-context.test.ts), and
// the active scope is read through useOperatorContext.
const h = vi.hoisted(() => ({
  setOperatorContext: vi.fn(),
  pickedOperatorId: undefined as string | undefined,
}))
vi.mock('./operator-context', () => ({
  useSetOperatorContext: () => h.setOperatorContext,
  useOperatorContext: () => ({ pickedOperatorId: h.pickedOperatorId }),
}))

const OPERATORS = [{ id: 'op_1', name: 'Sakura', slug: 'sakura' }] as const

function wrap(ui: React.ReactNode) {
  return render(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  )
}

describe('OperatorContextPicker', () => {
  beforeEach(() => {
    h.setOperatorContext.mockClear()
    h.pickedOperatorId = undefined
  })

  it('renders the "All operators" option', () => {
    wrap(<OperatorContextPicker operators={OPERATORS} />)
    expect(screen.getByText('All operators')).not.toBeNull()
  })

  it('sets the operator context to undefined when "All operators" is chosen (explicit clear)', () => {
    h.pickedOperatorId = 'op_1'
    wrap(<OperatorContextPicker operators={OPERATORS} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    expect(h.setOperatorContext).toHaveBeenCalledTimes(1)
    expect(h.setOperatorContext).toHaveBeenCalledWith(undefined)
  })

  it('sets the operator context to the chosen operator id', () => {
    wrap(<OperatorContextPicker operators={OPERATORS} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'op_1' } })
    expect(h.setOperatorContext).toHaveBeenCalledTimes(1)
    expect(h.setOperatorContext).toHaveBeenCalledWith('op_1')
  })

  it('reflects a picked operator id that is not in the options instead of falling back to "All operators"', () => {
    h.pickedOperatorId = 'op_unknown'
    wrap(<OperatorContextPicker operators={OPERATORS} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('op_unknown')
  })
})
