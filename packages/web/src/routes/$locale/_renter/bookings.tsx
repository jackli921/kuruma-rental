import { createFileRoute } from '@tanstack/react-router'

// Placeholder so the renter guard layout has a reachable child (`/<locale>/bookings`).
// Real renter bookings page ports in a later slice.
export const Route = createFileRoute('/$locale/_renter/bookings')({
  component: () => <main>Bookings (port pending)</main>,
})
