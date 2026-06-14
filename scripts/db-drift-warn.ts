#!/usr/bin/env bun
/**
 * db:drift-warn — a fast, NON-BLOCKING heads-up that the dev DB is behind this
 * worktree's migrations. Wired as `predev` / `predev:api` so `bun run dev[:api]`
 * surfaces the exact failure that silently broke the locations page once: a dev
 * server pointed at a DB that was several migrations stale.
 *
 * Deliberately NOT `db:verify`: that runs `drizzle-kit generate` (slow) and
 * flags uncommitted schema edits (noise) — wrong for a per-start hook. This does
 * one cheap count query, only speaks when something is wrong, and ALWAYS exits 0
 * so it can never block dev (web doesn't even need a DB). For commit/CI gating,
 * use `db:verify`.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const JOURNAL_PATH = resolve(import.meta.dir, '..', 'drizzle', 'meta', '_journal.json')

export type MigrationCounts = { journal: number; applied: number }

export type DriftStatus =
  | { kind: 'in-sync' }
  | { kind: 'behind'; pending: number; journal: number; applied: number }
  | { kind: 'ahead'; journal: number; applied: number }

export function assessDrift({ journal, applied }: MigrationCounts): DriftStatus {
  if (applied < journal) return { kind: 'behind', pending: journal - applied, journal, applied }
  if (applied > journal) return { kind: 'ahead', journal, applied }
  return { kind: 'in-sync' }
}

export function formatDriftWarning(status: DriftStatus): string | null {
  switch (status.kind) {
    // 'ahead' (DB has MORE migrations than this worktree) is benign — extra
    // tables/columns don't break reads — and common when several worktrees share
    // one local DB. Staying silent avoids the alarm fatigue that would erode the
    // 'behind' warning, which is the only actionable case.
    case 'in-sync':
    case 'ahead':
      return null
    case 'behind':
      return `⚠ Database is ${status.pending} migration(s) behind this worktree (journal ${status.journal}, DB ${status.applied}).
  Pages that read the new tables/columns will fail. Run \`bun run db:migrate\` before using the app.`
  }
}

function readJournalCount(): number | null {
  if (!existsSync(JOURNAL_PATH)) return null
  try {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as { entries?: unknown[] }
    return journal.entries?.length ?? null
  } catch {
    return null
  }
}

async function readAppliedCount(databaseUrl: string): Promise<number | null> {
  const postgres = (await import('postgres')).default
  const sql = postgres(databaseUrl, { max: 1 })
  try {
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`
    return rows[0]?.n ?? 0
  } finally {
    await sql.end()
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return // web dev needs no DB — nothing to assert
  const journal = readJournalCount()
  if (journal === null) return // no journal here — nothing to compare against
  try {
    const applied = await readAppliedCount(databaseUrl)
    if (applied === null) return
    const warning = formatDriftWarning(assessDrift({ journal, applied }))
    if (warning) console.warn(`\n${warning}\n`)
  } catch {
    // DB unreachable. Dev (especially web) may not need it — stay silent, never block.
  }
}

if (import.meta.main) {
  // Guarantee exit 0 regardless of outcome: this is a hint, never a gate.
  main().finally(() => process.exit(0))
}
