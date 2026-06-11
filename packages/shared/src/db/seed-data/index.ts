/**
 * Slice 8 demo seed fixtures (#390). Pure typed data consumed by the seed
 * builders in `seed.ts` / `seed-bookings.ts`. Kept side-effect-free so the
 * credibility-floor invariants (3 operators, 9 locations, ~41 vehicles across
 * 6-8 ACRISS codes, coherent fees) are unit-testable without a database.
 */
export { DEMO_OPERATORS, type DemoOperator, type DemoOwner } from './operators'
export { DEMO_REGIONS, type DemoRegion } from './regions'
export { DEMO_LOCATIONS, type DemoLocation } from './locations'
export { DEMO_VEHICLE_CLASSES, type DemoVehicleClass } from './classes'
export { DEMO_VEHICLES, type DemoVehicle } from './vehicles'
export { DEMO_INSURANCE_OPTIONS, type DemoInsuranceOption } from './insurance'
export { DEMO_ADD_ON_OPTIONS, type DemoAddOnOption } from './add-ons'
export { DEMO_FEE_SCHEDULES, type DemoFeeSchedule } from './fees'
export { DEMO_BOOKINGS, DEMO_RENTERS, type DemoBooking, type DemoRenter } from './bookings'
