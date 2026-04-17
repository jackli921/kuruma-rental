import { CalendarSidebar } from '@/components/calendar/CalendarSidebar'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const m: Record<string, string> = {
      title: 'Filters',
      'vehicles.title': 'Vehicles',
      'vehicles.all': 'All',
      'vehicles.none': 'None',
      'statuses.title': 'Status',
      'statuses.CONFIRMED': 'Confirmed',
      'statuses.ACTIVE': 'Active',
      'statuses.COMPLETED': 'Completed',
      'statuses.CANCELLED': 'Cancelled',
    }
    return m[key] ?? key
  },
}))

afterEach(() => cleanup())

const VEHICLES = [
  { id: 'v1', name: 'Toyota Prius' },
  { id: 'v2', name: 'Honda Civic' },
]

function makeApi(
  overrides: Partial<{
    isVehicleChecked: (id: string) => boolean
    isStatusChecked: (s: string) => boolean
  }> = {},
) {
  return {
    isVehicleChecked: overrides.isVehicleChecked ?? (() => true),
    isStatusChecked: overrides.isStatusChecked ?? (() => true),
    toggleVehicle: vi.fn(),
    toggleStatus: vi.fn(),
    selectAllVehicles: vi.fn(),
    clearAllVehicles: vi.fn(),
  }
}

describe('CalendarSidebar', () => {
  it('renders a checkbox for each vehicle', () => {
    render(<CalendarSidebar vehicles={VEHICLES} filters={makeApi()} />)
    expect(screen.getByRole('checkbox', { name: /toyota prius/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /honda civic/i })).toBeInTheDocument()
  })

  it('renders a checkbox for each of the four statuses', () => {
    render(<CalendarSidebar vehicles={VEHICLES} filters={makeApi()} />)
    expect(screen.getByRole('checkbox', { name: /confirmed/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /active/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /completed/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /cancelled/i })).toBeInTheDocument()
  })

  it('reflects filter state — unchecked vehicle shows unchecked', () => {
    const api = makeApi({ isVehicleChecked: (id) => id !== 'v1' })
    render(<CalendarSidebar vehicles={VEHICLES} filters={api} />)
    expect(screen.getByRole('checkbox', { name: /toyota prius/i })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /honda civic/i })).toBeChecked()
  })

  it('invokes toggleVehicle when a vehicle checkbox is clicked', () => {
    const api = makeApi()
    render(<CalendarSidebar vehicles={VEHICLES} filters={api} />)
    screen.getByRole('checkbox', { name: /toyota prius/i }).click()
    expect(api.toggleVehicle).toHaveBeenCalledWith('v1')
  })

  it('invokes toggleStatus when a status checkbox is clicked', () => {
    const api = makeApi()
    render(<CalendarSidebar vehicles={VEHICLES} filters={api} />)
    screen.getByRole('checkbox', { name: /cancelled/i }).click()
    expect(api.toggleStatus).toHaveBeenCalledWith('CANCELLED')
  })

  it('"All" and "None" buttons invoke select/clear for vehicles only', () => {
    const api = makeApi()
    render(<CalendarSidebar vehicles={VEHICLES} filters={api} />)
    const vehiclesFieldset = screen.getByRole('group', { name: /vehicles/i })
    within(vehiclesFieldset).getByRole('button', { name: /^all$/i }).click()
    expect(api.selectAllVehicles).toHaveBeenCalledOnce()
    within(vehiclesFieldset)
      .getByRole('button', { name: /^none$/i })
      .click()
    expect(api.clearAllVehicles).toHaveBeenCalledOnce()
  })
})
