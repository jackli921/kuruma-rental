#!/usr/bin/env bun
// ENFORCES: drizzle migration drift detection (schema<->snapshot, journal<->disk, journal monotonic, journal<->DB, critical DB objects)
// SSOT: CLAUDE.md § Database Migrations (drizzle)
/**
 * db:verify — detects drizzle migration drift BEFORE it causes a 500 in prod.
 *
 * Context: we have had two incidents where a schema change was committed without
 * its migration being generated or applied, crashing the booking page at runtime.
 * This script runs five checks; any failure exits non-zero and blocks CI / commits.
 *
 * Checks:
 *  1. Schema ↔ snapshot sync (drizzle-kit) — editing schema.ts without running
 *     db:generate is detected here. No DB connection required.
 *  2. Journal ↔ disk sync — every `_journal.json` entry must map to an on-disk
 *     `.sql` file and vice versa. No DB connection required.
 *  3. Journal `when` monotonicity — out-of-order timestamps are silently skipped
 *     by drizzle-kit migrate. No DB connection required.
 *  4. Journal ↔ DB sync — the number of applied migrations in
 *     `drizzle.__drizzle_migrations` must equal the number of journal entries.
 *  5. Critical custom DB objects exist — the double-booking EXCLUDE constraint,
 *     the effective-end trigger + CHECK, and the idempotency unique index live
 *     only in raw SQL (no drizzle snapshot), so the count checks above cannot see
 *     them. Assert each exists by name. See issue #702.
 *  6. Consent ledger append-only seal — the `kuruma_runtime` role must exist and
 *     must NOT hold UPDATE/DELETE on `consent_acceptances` (it may INSERT). This
 *     REVOKE (drizzle/0109) is snapshot-invisible like Check 5's objects; a bad
 *     restore or an accidental re-GRANT would silently reopen a legal ledger to
 *     tampering. See ADR-0001 (#1553) compliance clause.
 *
 * Checks 4, 5, and 6 need a DB; all are skipped cleanly when DATABASE_URL is unset
 * so the three static checks still gate local commits.
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '..')
const DRIZZLE_DIR = join(REPO_ROOT, 'drizzle')
const META_DIR = join(DRIZZLE_DIR, 'meta')
const JOURNAL_PATH = join(META_DIR, '_journal.json')

function listMigrationFiles(): Set<string> {
  return new Set(readdirSync(DRIZZLE_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)))
}

function listSnapshotFiles(): Set<string> {
  return new Set(readdirSync(META_DIR).filter((f) => /^\d{4}_snapshot\.json$/.test(f)))
}

type JournalEntry = { idx: number; tag: string; when: number }
type Journal = { entries: JournalEntry[] }

let failures = 0

function fail(check: string, detail: string): void {
  failures += 1
  console.error(`\n✗ ${check}`)
  console.error(detail.replace(/^/gm, '  '))
}

function pass(check: string, detail = ''): void {
  console.log(`✓ ${check}${detail ? ` — ${detail}` : ''}`)
}

// ---- Check 1: schema ↔ snapshot ----
//
// `drizzle-kit check` only validates journal integrity (hash collisions, duplicate
// idx entries). It does NOT detect drift between `schema.ts` and the latest
// snapshot. The only reliable way to detect that is to invoke the same diff
// engine drizzle-kit uses for generation: run `drizzle-kit generate`, and if
// it creates a new file, there's drift. We then rollback the accidental file
// + snapshot + journal mutation so the working tree is untouched.
const sqlFilesBefore = listMigrationFiles()
const snapshotFilesBefore = listSnapshotFiles()
const journalBefore = readFileSync(JOURNAL_PATH, 'utf8')

try {
  // Capture stdout. drizzle-kit exits 0 on some fatal conditions (snapshot
  // collisions, malformed journal) and writes the error to stdout. Without
  // checking the captured output, the success path below would run even when
  // the internal state was broken — false positive. See issue #349.
  const result = execSync('bunx drizzle-kit generate', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  const sqlFilesAfter = listMigrationFiles()
  const newFiles = [...sqlFilesAfter].filter((f) => !sqlFilesBefore.has(f))

  if (/^\s*Error:/im.test(result)) {
    fail('drizzle-kit generate produced an error', result.trim())
  } else if (newFiles.length === 0) {
    pass('schema.ts ↔ snapshot in sync', 'no pending changes')
  } else {
    // Rollback the accidental generation: delete the new .sql + snapshot, restore journal.
    for (const f of newFiles) unlinkSync(join(DRIZZLE_DIR, f))
    const snapshotFilesAfter = listSnapshotFiles()
    for (const f of [...snapshotFilesAfter].filter((f) => !snapshotFilesBefore.has(f))) {
      unlinkSync(join(META_DIR, f))
    }
    writeFileSync(JOURNAL_PATH, journalBefore)

    fail(
      'schema.ts ↔ snapshot drift detected',
      `packages/shared/src/db/schema.ts has uncommitted schema changes with no migration.
Run \`bun run db:generate --name <describe_change>\` then \`bun run db:migrate\`.

drizzle-kit would have created: ${newFiles.join(', ')}
(this script already rolled back the accidental generation)`,
    )
  }
} catch (err) {
  const stdout = (err as { stdout?: Buffer }).stdout?.toString() ?? ''
  const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? ''
  fail('drizzle-kit generate failed', `${stdout}\n${stderr}`.trim())
}

// ---- Check 2: journal ↔ disk ----
if (!existsSync(JOURNAL_PATH)) {
  fail('journal file missing', `Expected ${JOURNAL_PATH}`)
} else {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as Journal
  const journalTags = new Set(journal.entries.map((e) => e.tag))
  const diskTags = new Set(
    readdirSync(DRIZZLE_DIR)
      .filter((f) => /^\d{4}_.+\.sql$/.test(f))
      .map((f) => f.replace(/\.sql$/, '')),
  )

  const missingOnDisk = [...journalTags].filter((t) => !diskTags.has(t))
  const orphanOnDisk = [...diskTags].filter((t) => !journalTags.has(t))

  if (missingOnDisk.length > 0 || orphanOnDisk.length > 0) {
    const details: string[] = []
    if (missingOnDisk.length > 0) {
      details.push(`journal references missing files: ${missingOnDisk.join(', ')}`)
    }
    if (orphanOnDisk.length > 0) {
      details.push(
        `orphan .sql files not in journal: ${orphanOnDisk.join(', ')}
(hand-written migration? use \`bun run db:generate --custom --name <name>\` so drizzle tracks it)`,
      )
    }
    fail('journal ↔ disk sync', details.join('\n'))
  } else {
    pass('journal ↔ disk sync', `${journalTags.size} migrations`)
  }
}

// ---- Check 3: journal `when` monotonicity ----
//
// drizzle-kit migrate skips any entry whose `when` is older than the last-applied
// migration's `when`, while still printing "migrations applied successfully". A
// rebased or cherry-picked migration can inherit an earlier timestamp and be
// silently skipped, causing schema drift at runtime. See CLAUDE.md gotcha
// (2026-04-17 incident).
if (existsSync(JOURNAL_PATH)) {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as Journal
  const outOfOrder: string[] = []
  for (let i = 1; i < journal.entries.length; i++) {
    const prev = journal.entries[i - 1]
    const curr = journal.entries[i]
    if (!prev || !curr) continue
    if (curr.when <= prev.when) {
      outOfOrder.push(
        `${curr.tag} (when=${curr.when}) is not greater than ${prev.tag} (when=${prev.when})`,
      )
    }
  }
  if (outOfOrder.length > 0) {
    fail(
      'journal `when` monotonicity',
      `Out-of-order timestamps will be silently skipped by drizzle-kit migrate.
Bump each offending entry's \`when\` in drizzle/meta/_journal.json to
max(previous.when) + 1, then re-run \`bun run db:migrate\`.

${outOfOrder.join('\n')}`,
    )
  } else {
    pass('journal `when` monotonicity', `${journal.entries.length} entries strictly increasing`)
  }
}

// ---- Check 4: journal ↔ DB (only if DATABASE_URL set) ----
//
// CLAUDE.md gotcha: "migrations applied successfully" is not a reliable signal.
// The authoritative check is applied-count vs journal-count.
if (!process.env.DATABASE_URL) {
  console.log('• journal ↔ DB sync — skipped (no DATABASE_URL)')
} else {
  try {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as Journal
    const postgres = (await import('postgres')).default
    const sql = postgres(process.env.DATABASE_URL, { max: 1 })
    try {
      const rows = await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`
      const appliedCount = rows[0]?.n ?? 0
      if (appliedCount !== journal.entries.length) {
        fail(
          'journal ↔ DB sync',
          `Journal has ${journal.entries.length} migrations but the DB has applied ${appliedCount}.
Run \`bun run db:migrate\` to apply pending migrations.`,
        )
      } else {
        pass('journal ↔ DB sync', `${appliedCount} applied`)
      }
    } finally {
      await sql.end()
    }
  } catch (err) {
    fail(
      'journal ↔ DB sync',
      `Failed to query DB: ${(err as Error).message}
If the DB is intentionally unavailable, unset DATABASE_URL to skip this check.`,
    )
  }
}

// ---- Check 5: critical custom DB objects exist (only if DATABASE_URL set) ----
//
// The anti-double-booking EXCLUDE constraint, the effective-end trigger, its
// CHECK, and the idempotency unique index live ONLY in raw SQL (drizzle/0006,
// 0012, 0015, 0037). They appear in no drizzle snapshot, and Checks 1-4 compare
// only migration COUNTS — never object parity. A bad restore, a silently skipped
// migration (the 2026-04-17 incident), or a hand-edit can drop the only
// race-proof double-booking guard while every count check stays green, letting
// two paid bookings land on one car for one window. Assert each object by name,
// scoped to the bookings table.
type CriticalObject = {
  name: string
  kind: 'constraint' | 'trigger' | 'index'
  label: string
}

const CRITICAL_DB_OBJECTS: readonly CriticalObject[] = [
  { name: 'bookings_no_overlap', kind: 'constraint', label: 'double-booking EXCLUDE constraint' },
  {
    name: 'effective_end_at_after_end_at',
    kind: 'constraint',
    label: 'effective_end_at >= end_at CHECK',
  },
  {
    name: 'bookings_set_effective_end_at',
    kind: 'trigger',
    label: 'compute_effective_end_at trigger',
  },
  { name: 'bookings_idempotency_key', kind: 'index', label: 'idempotency partial unique index' },
]

if (!process.env.DATABASE_URL) {
  console.log('• critical DB objects — skipped (no DATABASE_URL)')
} else {
  try {
    const names = CRITICAL_DB_OBJECTS.map((o) => o.name)
    const postgres = (await import('postgres')).default
    const sql = postgres(process.env.DATABASE_URL, { max: 1 })
    try {
      // to_regclass is NULL-safe: it returns NULL instead of throwing if the
      // bookings table is absent, so a missing table reads as "all objects
      // missing" rather than crashing. `NOT tgisinternal` excludes the internal
      // triggers Postgres auto-creates for FK/CHECK enforcement.
      const constraints = await sql<{ name: string }[]>`
        SELECT conname AS name FROM pg_constraint
        WHERE conrelid = to_regclass('public.bookings') AND conname = ANY(${names})`
      const triggers = await sql<{ name: string }[]>`
        SELECT tgname AS name FROM pg_trigger
        WHERE tgrelid = to_regclass('public.bookings')
          AND NOT tgisinternal AND tgname = ANY(${names})`
      const indexes = await sql<{ name: string }[]>`
        SELECT indexname AS name FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'bookings' AND indexname = ANY(${names})`
      const present = new Set<string>([...constraints, ...triggers, ...indexes].map((r) => r.name))
      const missing = CRITICAL_DB_OBJECTS.filter((o) => !present.has(o.name))
      if (missing.length > 0) {
        fail(
          'critical DB objects',
          `Snapshot-invisible objects MISSING from the bookings table:
${missing.map((o) => `  - ${o.name} (${o.label})`).join('\n')}

These are defined only in raw-SQL migrations (drizzle/0006, 0012, 0015, 0037) and
are the race-proof guards behind instant-book. A skipped/out-of-order migration or
a bad restore can drop them while the count checks stay green. Restore them by
re-running \`bun run db:migrate\` against a clean DB, or re-applying the object SQL.`,
        )
      } else {
        pass(
          'critical DB objects',
          `${CRITICAL_DB_OBJECTS.length} present (exclusion, check, trigger, idempotency)`,
        )
      }
    } finally {
      await sql.end()
    }
  } catch (err) {
    fail(
      'critical DB objects',
      `Failed to query DB: ${(err as Error).message}
If the DB is intentionally unavailable, unset DATABASE_URL to skip this check.`,
    )
  }
}

// ---- Check 6: consent ledger append-only seal (only if DATABASE_URL set) ----
//
// consent_acceptances is a legal evidence ledger. In place of the dropped HMAC
// record signature (#1553), row integrity is enforced by role separation: the
// application runtime connects as the non-owner `kuruma_runtime` role, which may
// INSERT/SELECT but never UPDATE/DELETE this table (REVOKE in drizzle/0109). That
// REVOKE is snapshot-invisible — Checks 1-5 cannot see it — so a bad restore, an
// out-of-order migration, or an accidental `GRANT UPDATE` could silently reopen
// the ledger to tampering while every count check stays green. Assert the seal by
// querying the live privilege, not the migration text. See ADR-0001 (#1553).
const RUNTIME_ROLE = 'kuruma_runtime'
const LEDGER_TABLE = 'public.consent_acceptances'

if (!process.env.DATABASE_URL) {
  console.log('• consent append-only seal — skipped (no DATABASE_URL)')
} else {
  try {
    const postgres = (await import('postgres')).default
    const sql = postgres(process.env.DATABASE_URL, { max: 1 })
    try {
      // has_table_privilege throws if the role or table is absent, so guard first.
      const [pre] = await sql<{ role_exists: boolean; table_exists: boolean }[]>`
        SELECT
          EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ${RUNTIME_ROLE}) AS role_exists,
          to_regclass(${LEDGER_TABLE}) IS NOT NULL AS table_exists`
      if (!pre?.role_exists || !pre?.table_exists) {
        fail(
          'consent append-only seal',
          `The ${RUNTIME_ROLE} role or ${LEDGER_TABLE} table is missing (role_exists=${pre?.role_exists}, table_exists=${pre?.table_exists}).
The append-only seal from drizzle/0109 is not in place. Re-run \`bun run db:migrate\` against a clean DB.`,
        )
      } else {
        const [priv] = await sql<
          { can_update: boolean; can_delete: boolean; can_insert: boolean }[]
        >`
          SELECT
            has_table_privilege(${RUNTIME_ROLE}, ${LEDGER_TABLE}, 'UPDATE') AS can_update,
            has_table_privilege(${RUNTIME_ROLE}, ${LEDGER_TABLE}, 'DELETE') AS can_delete,
            has_table_privilege(${RUNTIME_ROLE}, ${LEDGER_TABLE}, 'INSERT') AS can_insert`
        if (priv?.can_update || priv?.can_delete || !priv?.can_insert) {
          fail(
            'consent append-only seal',
            `The ${RUNTIME_ROLE} role has the WRONG privileges on ${LEDGER_TABLE} (UPDATE=${priv?.can_update}, DELETE=${priv?.can_delete}, INSERT=${priv?.can_insert}).
Expected UPDATE=false, DELETE=false, INSERT=true. A legal ledger is append-only; corrections run through the owner (break-glass) role, never the app runtime.
Re-apply the REVOKE from drizzle/0109 (\`REVOKE UPDATE, DELETE ON consent_acceptances FROM ${RUNTIME_ROLE}\`).`,
          )
        } else {
          pass('consent append-only seal', `${RUNTIME_ROLE} INSERT-only on consent_acceptances`)
        }
      }
    } finally {
      await sql.end()
    }
  } catch (err) {
    fail(
      'consent append-only seal',
      `Failed to query DB: ${(err as Error).message}
If the DB is intentionally unavailable, unset DATABASE_URL to skip this check.`,
    )
  }
}

// ---- Exit ----
if (failures > 0) {
  console.error(`\n${failures} check(s) failed. Fix drift before committing.`)
  process.exit(1)
}
console.log('\nAll drizzle drift checks passed.')
