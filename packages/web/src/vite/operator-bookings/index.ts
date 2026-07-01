// Barrel for the operator-bookings feature's UI surface. Cross-feature consumers
// (the `/manage/bookings` route) import components via `@/vite/operator-bookings`
// rather than reaching into individual files — the module-boundary rule (#1110;
// docs/architecture/modules.md). Data/transform modules (api, calendar-events) keep
// their own deep imports for now; this barrel covers the rendered components.
export { BlockDetailDialog } from './BlockDetailDialog'
export { BlockLegend } from './BlockLegend'
export { BookingsCalendar } from './BookingsCalendar'
export { CalendarSidebar } from './CalendarSidebar'
export { FleetTimeline } from './FleetTimeline'
export { ManualBookingDialog } from './ManualBookingDialog'
export { ScheduleBlockDialog } from './ScheduleBlockDialog'
