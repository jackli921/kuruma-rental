/**
 * Parse the `PLATFORM_ADMIN_EMAILS` env allowlist into a normalized list:
 * comma-separated, trimmed, lowercased, de-duplicated, empties dropped.
 *
 * Drives the seed-time promotion of bootstrap platform admins (proposal §9
 * item 23 — public operator signup is post-MVP, so the first PLATFORM_ADMIN
 * is established from the environment, not a UI).
 */
export function parsePlatformAdminEmails(raw: string | undefined): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const email = part.trim().toLowerCase()
    if (email) seen.add(email)
  }
  return [...seen]
}
