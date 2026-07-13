// Public surface of the regions feature for cross-feature consumers. The shared
// LocationCombobox (#1543) is also used by operator-locations; import it via
// `@/vite/regions` rather than deep-importing the internal file, per the module-boundary
// rule (docs/architecture/modules.md).
export { LocationCombobox } from './LocationCombobox'
export type { LocationComboboxProps } from './LocationCombobox'
