import { createFileRoute } from '@tanstack/react-router'

// Placeholder so `/<locale>/bookings` stays reachable; the real renter bookings
// list ports in a later slice.
export const Route = createFileRoute('/$locale/_renter/bookings/')({
  component: () => <main>Bookings (port pending)</main>,
})
