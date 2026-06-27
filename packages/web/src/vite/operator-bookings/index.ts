// Public surface of the operator-bookings feature.
// Routes import the fleet-timeline view from this barrel (`@/vite/operator-bookings`)
// rather than reaching into the file directly — see scripts/lint-module-boundaries.ts
// (#1110 ratchet). Only the newly-added FleetTimeline (#1100) is routed through the
// barrel here; the feature's pre-existing deep imports are baseline debt to be drained
// in a later pass, not in this view-only slice.
export { FleetTimeline } from './FleetTimeline'
