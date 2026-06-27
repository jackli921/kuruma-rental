import { fireEvent, render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { OperatorsView } from './OperatorsView'
import type { OperatorAdminRow } from './api'

const row = (over: Partial<OperatorAdminRow> = {}): OperatorAdminRow => ({
  id: 'op_1',
  name: 'Kanata Cars',
  slug: 'kanata-cars',
  deactivatedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  fleetCount: 12,
  ...over,
})

type ViewProps = Parameters<typeof OperatorsView>[0]

function renderView(over: Partial<ViewProps> = {}) {
  const props: ViewProps = {
    operators: [row()],
    locale: 'en',
    togglingId: null,
    onCreate: vi.fn(),
    onEdit: vi.fn(),
    onInvite: vi.fn(),
    onToggleActive: vi.fn(),
    ...over,
  }
  render(
    <IntlProvider locale="en" messages={en}>
      <OperatorsView {...props} />
    </IntlProvider>,
  )
  return props
}

const T = en.admin.operators

describe('OperatorsView', () => {
  it('shows the empty state when there are no operators', () => {
    renderView({ operators: [] })
    expect(screen.getByText(T.empty)).not.toBeNull()
    expect(screen.queryByText('Kanata Cars')).toBeNull()
  })

  it('renders an active operator row with name, slug, fleet count and active status', () => {
    renderView()
    const cells = within(screen.getByRole('row', { name: /Kanata Cars/ }))
    expect(cells.getByText('Kanata Cars')).not.toBeNull()
    expect(cells.getByText('kanata-cars')).not.toBeNull()
    expect(cells.getByText('12')).not.toBeNull()
    expect(cells.getByText(T.status.active)).not.toBeNull()
    // An active operator offers Deactivate, not Reactivate.
    expect(cells.getByRole('button', { name: T.row.deactivate })).not.toBeNull()
    expect(cells.queryByRole('button', { name: T.row.reactivate })).toBeNull()
  })

  it('renders a deactivated operator with Deactivated status and a Reactivate action', () => {
    renderView({ operators: [row({ deactivatedAt: '2026-06-20T09:30:00.000Z' })] })
    expect(screen.getByText(T.status.deactivated)).not.toBeNull()
    expect(screen.getByRole('button', { name: T.row.reactivate })).not.toBeNull()
  })

  it('fires onCreate, onInvite, onEdit and onToggleActive from the right controls', () => {
    const props = renderView()
    fireEvent.click(screen.getByRole('button', { name: T.create }))
    fireEvent.click(screen.getByRole('button', { name: T.row.invite }))
    fireEvent.click(screen.getByRole('button', { name: T.row.edit }))
    fireEvent.click(screen.getByRole('button', { name: T.row.deactivate }))
    expect(props.onCreate).toHaveBeenCalledOnce()
    expect(props.onInvite).toHaveBeenCalledWith(expect.objectContaining({ id: 'op_1' }))
    expect(props.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'op_1' }))
    expect(props.onToggleActive).toHaveBeenCalledWith(expect.objectContaining({ id: 'op_1' }))
  })

  it('disables the toggle while that row is in flight', () => {
    renderView({ togglingId: 'op_1' })
    expect(screen.getByRole('button', { name: T.row.deactivating })).toHaveProperty(
      'disabled',
      true,
    )
  })
})
