// Canonical Drizzle schema surface. Tables + pgEnums are split by bounded context
// into sibling db/<context>.ts modules (#725) and re-exported here so every
// existing `@kuruma/shared/db/schema` import, and drizzle-kit's snapshot
// discovery, stay stable. Each context module colocates its tables, pgEnums, and
// the derived enum string-union types (sourced from ../enums, #688). Adding a
// table = a new db/<context>.ts (or a table in an existing one) + an `export *`
// line here. Mirrors the pre-existing fragment convention (add-on, regions, etc.).
export * from './auth'
export * from './location'
export * from './fleet'
export * from './pricing'
export * from './booking'
export * from './payment'
export * from './messaging'
export * from './notification'
export * from './audit'
export * from './compliance'

// Sibling schema fragments split out before #725. add_on_options + payload types
// (#460); operator_memberships + provider_invites + their enums (#521);
// renter_documents (slice 459); the region taxonomy tree (#394, also imported by
// ./location for the locations.regionId FK).
export * from './add-on'
export * from './booking-types'
export * from './provider-access'
export { documentStatusEnum, documentTypeEnum, renterDocuments } from './renter-documents'
export { regions, regionTypeEnum, regionStatusEnum } from './regions'
export * from './consent'
export * from './review'
export * from './feature-flags'
