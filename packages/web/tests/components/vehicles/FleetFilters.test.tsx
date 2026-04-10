import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock next-intl so tests don't depend on translation content.
// t(key) returns the key verbatim, so queries use keys (not English strings).
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { FleetFilters } from '@/components/vehicles/FleetFilters'
import type { FleetFilterState, SortOrder } from '@/lib/fleet-filters'

const defaultProps = {
  filters: {} satisfies FleetFilterState,
  sort: 'name-asc' as SortOrder,
  onFiltersChange: vi.fn(),
  onSortChange: vi.fn(),
  seatsBounds: { min: 2, max: 8 },
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

  it('hides the capacity slider section when all vehicles have the same seat count', () => {
    render(<FleetFilters {...defaultProps} seatsBounds={{ min: 5, max: 5 }} />)

    // The seats section heading should not be rendered when there is no range to pick from
    expect(screen.queryByRole('slider')).toBeNull()
  })
})
