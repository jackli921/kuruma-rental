import { isPlatformAdmin } from '@/lib/platform-roles'
import type { UserRole } from '@kuruma/shared/auth/roles'

/**
 * Visibility rule for post-MVP features
 * (design: docs/plans/2026-06-26-mvp-feature-gating-design.md §4).
 *
 * A feature whose build-time flag is OFF is hidden in beta — EXCEPT for the
 * platform admin, who always sees it so the owner can preview every feature on the
 * live beta site without a separate build. One deployment, two audiences.
 *
 * Visibility ONLY — this is NOT an authorization boundary. The API still enforces
 * its own per-participant / per-role access; this just decides what the UI
 * advertises (design §2.1). Never use it to guard a write or a money path.
 */
export function isVisibleToViewer(flagEnabled: boolean, role: UserRole | undefined): boolean {
  return flagEnabled || isPlatformAdmin(role)
}
