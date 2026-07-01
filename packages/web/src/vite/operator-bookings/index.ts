// Barrel for the operator-bookings feature's UI surface. Cross-feature consumers
// (the `/manage/bookings` route) import components via `@/vite/operator-bookings`
// rather than reaching into individual files — the module-boundary rule (#1110;
// docs/architecture/modules.md). Data/transform modules (api, calendar-events) keep
// their own deep imports for now; this barrel covers the rendered components.
export { BlockDetailDialog } from './BlockDetailDialog'
export { BlockLegend } from './BlockLegend'
export { BookingsCalendar } from './BookingsCalendar'
export { CalendarSidebar } from './CalendarSidebar'
export { ManualBookingDialog } from './ManualBookingDialog'
export { ScheduleBlockDialog } from './ScheduleBlockDialog'

// FleetTimeline is intentionally NOT re-exported here. It statically imports
// react-calendar-timeline + interactjs + their CSS (~460KB gzipped), and CSS
// imports are side effects the bundler cannot tree-shake — a barrel re-export would
// drag that lib into every chunk that touches this barrel. The route lazy-loads it
// directly (`import('./FleetTimeline')`) so the lib stays out of the main chunk
// until the (flag-gated) timeline view is selected (#1099).
