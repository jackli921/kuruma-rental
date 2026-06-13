import { OperatorLocationsView } from '@/vite/operator-locations/OperatorLocationsView'
import type { OperatorLocation } from '@/vite/operator-locations/api'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

const en = enMessages.business.locations

function location(overrides: Partial<OperatorLocation> = {}): OperatorLocation {
  return {
    id: 'loc_1',
    operatorId: 'op_1',
    name: 'Namba Branch',
    address: '1-2-3 Namba, Chuo-ku, Osaka',
    operatingHours: { openTime: '09:00', closeTime: '20:00' },
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE',
    coordinateSource: 'GEOCODED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderView(
  locations: OperatorLocation[],
  handlers: {
    onEdit?: (l: OperatorLocation) => void
    onArchive?: (l: OperatorLocation) => void
  } = {},
) {
  const onEdit = handlers.onEdit ?? vi.fn()
  const onArchive = handlers.onArchive ?? vi.fn()
  render(
    <IntlProvider locale="en" messages={enMessages}>
      <OperatorLocationsView locations={locations} onEdit={onEdit} onArchive={onArchive} />
    </IntlProvider>,
  )
  return { onEdit, onArchive }
}

describe('OperatorLocationsView', () => {
  it('shows the empty state when there are no locations', () => {
    renderView([])
    expect(screen.getByText(en.empty)).toBeInTheDocument()
  })

  it('renders a location row with name, address, status and operating hours', () => {
    renderView([location()])
    expect(screen.getByText('Namba Branch')).toBeInTheDocument()
    expect(screen.getByText('1-2-3 Namba, Chuo-ku, Osaka')).toBeInTheDocument()
    expect(screen.getByText(en.status.ACTIVE)).toBeInTheDocument()
    // row.hours = "{open}–{close}" (en dash)
    expect(screen.getByText('09:00–20:00')).toBeInTheDocument()
  })

  it('shows "hours not set" when operatingHours is null', () => {
    renderView([location({ id: 'l2', operatingHours: null })])
    expect(screen.getByText(en.row.alwaysOpen)).toBeInTheDocument()
  })

  it('formats turnaround minutes as whole hours', () => {
    renderView([location({ id: 'l3', defaultTurnaroundMinutes: 2880 })])
    expect(screen.getByText('48h turnaround')).toBeInTheDocument()
  })

  it('renders the archived badge for an archived location', () => {
    renderView([location({ id: 'l4', status: 'ARCHIVED' })])
    expect(screen.getByText(en.status.ARCHIVED)).toBeInTheDocument()
  })

  it('renders one row per location', () => {
    renderView([location({ id: 'a', name: 'Loc A' }), location({ id: 'b', name: 'Loc B' })])
    expect(screen.getByText('Loc A')).toBeInTheDocument()
    expect(screen.getByText('Loc B')).toBeInTheDocument()
    expect(screen.getAllByTestId('location-row')).toHaveLength(2)
  })

  it('calls onEdit with the location when the edit button is clicked', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderView([location()])
    await user.click(screen.getByRole('button', { name: en.editLocation }))
    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'loc_1', name: 'Namba Branch' }),
    )
  })

  it('calls onArchive with the location when the archive button is clicked', async () => {
    const user = userEvent.setup()
    const { onArchive } = renderView([location()])
    await user.click(screen.getByRole('button', { name: en.archiveAction }))
    expect(onArchive).toHaveBeenCalledWith(expect.objectContaining({ id: 'loc_1' }))
  })

  it('disables the archive button for an archived location', () => {
    renderView([location({ id: 'l4', status: 'ARCHIVED' })])
    expect(screen.getByRole('button', { name: en.archiveAction })).toBeDisabled()
  })

  it('flags a throttle-skipped location with a "pin pending" badge (#601)', () => {
    renderView([location({ id: 'lp', coordinateSource: 'PENDING' })])
    expect(screen.getByText(en.pin.pending)).toBeInTheDocument()
  })

  it('flags a location with no geocode result as "no map pin" (#601)', () => {
    renderView([location({ id: 'ln', coordinateSource: null })])
    expect(screen.getByText(en.pin.missing)).toBeInTheDocument()
  })

  it.each(['GEOCODED', 'MANUAL'] as const)(
    'shows no pin-state badge for a %s location (#601)',
    (coordinateSource) => {
      renderView([location({ id: 'lg', coordinateSource })])
      expect(screen.queryByText(en.pin.pending)).not.toBeInTheDocument()
      expect(screen.queryByText(en.pin.missing)).not.toBeInTheDocument()
    },
  )

  it('omits the edit/archive row actions in read-only mode (no handlers — bypass roles)', () => {
    render(
      <IntlProvider locale="en" messages={enMessages}>
        <OperatorLocationsView locations={[location()]} />
      </IntlProvider>,
    )
    expect(screen.getByTestId('location-row')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.editLocation })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.archiveAction })).not.toBeInTheDocument()
  })
})
