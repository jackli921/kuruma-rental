import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock next-intl so tests don't depend on translation content.
// t(key) returns the key verbatim; t(key, params) appends param values
// so badges with different counts get distinguishable accessible names.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (!params) return key
    const suffix = Object.values(params).join(',')
    return `${key}(${suffix})`
  },
}))

import { FleetFilters } from '@/components/vehicles/FleetFilters'
import type { FleetFilterState, SortOrder } from '@/lib/fleet-filters'

const defaultProps = {
  filters: {} satisfies FleetFilterState,
  sort: 'name-asc' as SortOrder,
  onFiltersChange: vi.fn(),
  onSortChange: vi.fn(),
  seatsBounds: { min: 2, max: 8 },
  availableMakes: ['Honda', 'Toyota'],
  availableModels: ['Aqua', 'Fit'],
  availableYears: [2024, 2023, 2022],
  availableColors: ['Black', 'White'],
}

describe('FleetFilters', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('calls onFiltersChange with the new search value when the user types', async () => {
    const onFiltersChange = vi.fn()
    const user = userEvent.setup()

    render(<FleetFilters {...defaultProps} filters={{}} onFiltersChange={onFiltersChange} />)

    const searchInput = screen.getByPlaceholderText('searchPlaceholder')
    await user.type(searchInput, 'P')

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ search: 'P' }))
  })

  it('toggles AVAILABLE status on when clicking the chip in an empty state', async () => {
    const onFiltersChange = vi.fn()
    const user = userEvent.setup()

    render(<FleetFilters {...defaultProps} filters={{}} onFiltersChange={onFiltersChange} />)

    await user.click(screen.getByRole('button', { name: 'status.AVAILABLE' }))

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['AVAILABLE'] }),
    )
  })

  it('toggles AVAILABLE status off when already selected', async () => {
    const onFiltersChange = vi.fn()
    const user = userEvent.setup()

    render(
      <FleetFilters
        {...defaultProps}
        filters={{ statuses: ['AVAILABLE', 'MAINTENANCE'] }}
        onFiltersChange={onFiltersChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'status.AVAILABLE' }))

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['MAINTENANCE'] }),
    )
  })

  it('toggles AUTO transmission on when clicking the chip in an empty state', async () => {
    const onFiltersChange = vi.fn()
    const user = userEvent.setup()

    render(<FleetFilters {...defaultProps} filters={{}} onFiltersChange={onFiltersChange} />)

    await user.click(screen.getByRole('button', { name: 'transmissionAuto' }))

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ transmissions: ['AUTO'] }),
    )
  })

  it('calls onSortChange when the user picks a new sort order', async () => {
    const onSortChange = vi.fn()
    const user = userEvent.setup()

    render(<FleetFilters {...defaultProps} sort="name-asc" onSortChange={onSortChange} />)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'sortSeatsDesc' }))

    expect(onSortChange).toHaveBeenCalledWith('seats-desc')
  })

  it('hides the capacity section when all vehicles have the same seat count', () => {
    render(<FleetFilters {...defaultProps} seatsBounds={{ min: 5, max: 5 }} />)

    expect(screen.queryByText('capacityHeading')).toBeNull()
  })

  it('toggles a seat count badge on when clicked', async () => {
    const onFiltersChange = vi.fn()
    const user = userEvent.setup()

    render(
      <FleetFilters
        {...defaultProps}
        filters={{}}
        onFiltersChange={onFiltersChange}
        seatsBounds={{ min: 2, max: 5 }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'seatsBadgeLabel(4)' }))

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ seats: [4] }))
  })

  it('toggles a seat count badge off when already selected', async () => {
    const onFiltersChange = vi.fn()
    const user = userEvent.setup()

    render(
      <FleetFilters
        {...defaultProps}
        filters={{ seats: [4, 5] }}
        onFiltersChange={onFiltersChange}
        seatsBounds={{ min: 2, max: 5 }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'seatsBadgeLabel(4)' }))

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ seats: [5] }))
  })
})
