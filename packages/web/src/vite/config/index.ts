// Barrel for the build-time config feature: post-MVP feature flags and the
// admin-bypass visibility rule. Import these via `@/vite/config` (not the internal
// files) so cross-feature consumers go through the barrel — see docs/architecture/modules.md.
export * from './features'
export * from './feature-visibility'
