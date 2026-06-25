import { Outlet, createFileRoute } from '@tanstack/react-router'

// Layout for everything under `/<locale>/messages` (#1032). The renter guard
// lives on the parent `_renter` route; `/messages` renders the inbox index child
// and `/messages/$threadId` the conversation view.
export const Route = createFileRoute('/$locale/_renter/messages')({
  component: Outlet,
})
