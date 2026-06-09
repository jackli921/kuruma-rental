import { Outlet, createFileRoute } from '@tanstack/react-router'

// Layout for everything under `/<locale>/bookings` (the renter guard lives on the
// parent `_renter` route). `/bookings` itself renders the index child; `/bookings/new`
// renders the reservation wizard (#460).
export const Route = createFileRoute('/$locale/_renter/bookings')({
  component: Outlet,
})
