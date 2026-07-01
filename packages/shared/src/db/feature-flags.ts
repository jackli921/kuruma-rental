import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Runtime feature-flag overrides set by a platform admin from the dashboard
// (epic: runtime feature flags). The presence of a row IS the override; `enabled`
// is what it forces. An absent row means the flag follows its build-time env
// default, so this table is additive and fail-safe — a fresh DB with no rows
// behaves exactly as today. See the shared FEATURE_FLAGS registry and
// docs/plans/2026-06-30-runtime-feature-flags.md.
//
// Global, single row per key — a platform control plane, NOT tenant data, so no
// operatorId. "Revert to default" is a row delete (not surfaced in the MVP UI;
// owner picked ON/OFF-only toggles).
export const featureFlags = pgTable('feature_flags', {
  // Matches a key in the shared FEATURE_FLAGS registry. Unknown keys are
  // rejected at the API (isFeatureFlagKey) and never written.
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  // Platform admin who last set it (audit trail). Nullable for a seeded row.
  updatedBy: text('updatedBy'),
})
