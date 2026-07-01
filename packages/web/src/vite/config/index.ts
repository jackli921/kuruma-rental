// Barrel for the config feature: build-time feature flags, the runtime override
// layer (FeatureFlagsProvider + useFeatureFlag), and the admin-bypass visibility
// rule. Import these via `@/vite/config` (not the internal files) so cross-feature
// consumers go through the barrel — see docs/architecture/modules.md.
export * from './features'
export * from './feature-visibility'
export * from './feature-flags-runtime'
export { FeatureFlagsProvider, useFeatureFlag } from './FeatureFlagsProvider'
