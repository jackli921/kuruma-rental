import '@testing-library/jest-dom/vitest'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import { BookingConfirmationView } from './BookingConfirmationView'
import type { BookingDto } from './api'

function makeBooking(overrides: Partial<BookingDto> = {}): BookingDto {
  return {
    id: 'bk_1',
    bookingCode: 'KX-ABC123',
    renterId: 'usr_1',
    classId: null,
    requestedVehicleId: 'veh_1',
    assignedVehicleId: 'veh_1',
    pickupLocationId: 'loc_kix',
    dropoffLocationId: 'loc_kix',
    startAt: '2026-07-01T00:00:00.000Z',
    endAt: '2026-07-03T01:30:00.000Z',
    effectiveEndAt: '2026-07-03T03:30:00.000Z',
    status: 'CONFIRMED',
    source: 'WEB',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    totalPrice: 30000,
    notes: null,
    createdAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:00.000Z',
    operator: { name: 'Best Car Rental', preAuthHandoffUrl: null },
    ...overrides,
  }
}

// Minimal stub router so the component's TanStack <Link>s resolve to hrefs. Mirrors
// the real route paths the view links to; the index route renders the view itself.
function renderConfirmation(booking: BookingDto) {
  const rootRoute = createRootRoute()
  const localeRoute = createRoute({ getParentRoute: () => rootRoute, path: '$locale' })
  const indexRoute = createRoute({
    getParentRoute: () => localeRoute,
    path: '/',
    component: () => (
      <IntlProvider locale="en" messages={en}>
        <BookingConfirmationView booking={booking} vehicleClass={null} csrfToken={null} />
      </IntlProvider>
    ),
  })
  const stub = (path: string) =>
    createRoute({ getParentRoute: () => localeRoute, path, component: () => null })
  const routeTree = rootRoute.addChildren([
    localeRoute.addChildren([
      indexRoute,
      stub('storefronts/$locationId'),
      stub('bookings'),
      stub('vehicles'),
    ]),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/en'] }),
  })
  return render(<RouterProvider router={router} />)
}

describe('BookingConfirmationView', () => {
  it('renders inside the stub router (harness sanity)', async () => {
    renderConfirmation(makeBooking())
    expect(await screen.findByText('KX-ABC123')).toBeInTheDocument()
  })

  it('shows the rental company name in its own block', async () => {
    renderConfirmation(
      makeBooking({ operator: { name: 'Best Car Rental', preAuthHandoffUrl: null } }),
    )
    expect(await screen.findByText('Rental company')).toBeInTheDocument()
    // Operator name renders once: the pre-auth card that also shows it is hidden
    // here because the fixture's preAuthHandoffUrl is null.
    expect(screen.getByText('Best Car Rental')).toBeInTheDocument()
  })

  it('omits the rental company block when the booking has no operator', async () => {
    renderConfirmation(makeBooking({ operator: undefined }))
    await screen.findByText('KX-ABC123') // ensure the view mounted before asserting absence
    expect(screen.queryByText('Rental company')).toBeNull()
  })

  it('links to the storefront with a JST range the route parser accepts', async () => {
    renderConfirmation(
      makeBooking({
        pickupLocationId: 'loc_kix',
        startAt: '2026-07-01T00:00:00.000Z',
        endAt: '2026-07-03T01:30:00.000Z',
      }),
    )
    const link = await screen.findByRole('link', { name: 'View storefront' })
    const url = new URL(link.getAttribute('href') ?? '', 'http://localhost')
    expect(url.pathname).toBe('/en/storefronts/loc_kix')
    expect(url.searchParams.get('from')).toBe('2026-07-01T09:00')
    expect(url.searchParams.get('to')).toBe('2026-07-03T10:30')
  })
})
