#!/usr/bin/env bun
/**
 * db:verify — detects drizzle migration drift BEFORE it causes a 500 in prod.
 *
 * Context: we have had two incidents where a schema change was committed without
 * its migration being generated or applied, crashing the booking page at runtime.
 * This script runs three checks; any failure exits non-zero and blocks CI / commits.
 *
 * Checks:
 *  1. Schema ↔ snapshot sync (drizzle-kit check) — editing schema.ts without
 *     running db:generate is detected here. No DB connection required.
 *  2. Journal ↔ disk sync — every `_journal.json` entry must map to an on-disk
 *     `.sql` file and vice versa. No DB connection required.
 *  3. Journal ↔ DB sync — the number of applied migrations in
 *     `drizzle.__drizzle_migrations` must equal the number of journal entries.
 *     Only runs when DATABASE_URL is set (skipped cleanly otherwise so the other
 *     two checks still gate local commits).
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

// ---- Exit ----
if (failures > 0) {
  console.error(`\n${failures} check(s) failed. Fix drift before committing.`)
  process.exit(1)
}
console.log('\nAll drizzle drift checks passed.')
