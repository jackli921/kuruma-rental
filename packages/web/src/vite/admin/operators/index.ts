// Public surface of the admin operators feature (#1088, epic #1075 slice 2).
// Routes and other features import from this barrel (`@/vite/admin/operators`)
// rather than reaching into individual files, keeping the cross-feature coupling
// surface to a single path — see scripts/lint-module-boundaries.ts (#1110 ratchet).
// OperatorRow is intentionally not re-exported: it is an internal detail of
// OperatorsView, not part of the feature's public API.
export { OperatorCreateDialog } from './OperatorCreateDialog'
export { OperatorEditDialog } from './OperatorEditDialog'
export { OperatorsView } from './OperatorsView'
export { ProviderInviteDialog } from './ProviderInviteDialog'
export * from './api'
