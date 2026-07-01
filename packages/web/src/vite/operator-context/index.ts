// Public surface of the operator-context feature. Cross-feature consumers (e.g.
// BusinessLayout, config pages in slice 1) import from this barrel — never the
// internal modules — so the vite cross-feature reach-in ratchet stays flat
// (scripts/lint-module-boundaries.ts, docs/architecture/modules.md).
export { fetchOperators, operatorsQueryOptions, type OperatorSummary } from './api'
export { OperatorBadge } from './OperatorBadge'
export { OperatorContextPicker } from './OperatorContextPicker'
export {
  buildScopeParam,
  OPERATOR_CONTEXT_ROUTE_IDS,
  type OperatorScope,
  parseOperatorSearch,
  useIsOperatorContextRoute,
  useOperatorContext,
  useOperatorScope,
  useOptionalPickedOperatorId,
  type WithOperatorId,
} from './operator-context'
