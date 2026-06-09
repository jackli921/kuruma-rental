#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Slice 8 §7 perf budget — renter first-load JS < 500 KB (proposal §7 / §8.2).
 *
 * The Next 16 Turbopack build does NOT print the classic "First Load JS" table,
 * and emits no `app-build-manifest.json`, so there is no public per-route client
 * chunk map to parse. What IS exposed (`build-manifest.json`) is the shared
 * first-load set — `rootMainFiles` (app shell) + `polyfillFiles` — that EVERY
 * route downloads before anything route-specific. This script measures that
 * shared baseline (raw bytes, matching Next's uncompressed First Load JS metric)
 * and gates it at 500 KB: if the floor every renter page pays is already over,
 * every route is over. Per-route deltas need a webpack build or a runtime
 * (Playwright) network measure — tracked as a follow-up.
 *
 * Per §7 the perf NFR is "measure + record, not yet SLO-gated", so CI runs this
 * as an advisory (continue-on-error) step; it still exits non-zero when over so
 * it can become a hard gate once the shared baseline is trimmed under budget.
 */
export const FIRST_LOAD_BUDGET_BYTES = 500 * 1024
const NEXT_DIR = 'packages/web/.next'

export type BuildManifest = {
  readonly rootMainFiles?: readonly string[]
  readonly polyfillFiles?: readonly string[]
}

/** Build-relative JS files every route loads first, deduped, order-preserving. */
export function sharedFirstLoadFiles(manifest: BuildManifest): string[] {
  const all = [...(manifest.rootMainFiles ?? []), ...(manifest.polyfillFiles ?? [])]
  return [...new Set(all)].filter((f) => f.endsWith('.js'))
}

/** Sum of on-disk bytes for the given build-relative files under `nextDir`. */
export function sumBytes(files: readonly string[], nextDir: string): number {
  return files.reduce((total, f) => total + statSync(join(nextDir, f)).size, 0)
}

/** Sum of every JS file in `<nextDir>/static/chunks` (first-load + lazy). */
export function totalChunkBytes(nextDir: string): number {
  const dir = join(nextDir, 'static/chunks')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .reduce((total, f) => total + statSync(join(dir, f)).size, 0)
}

export type BudgetResult = {
  readonly bytes: number
  readonly budgetBytes: number
  readonly overBudget: boolean
}

export function checkBudget(bytes: number, budgetBytes = FIRST_LOAD_BUDGET_BYTES): BudgetResult {
  return { bytes, budgetBytes, overBudget: bytes > budgetBytes }
}

export function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`
}

function main(): number {
  const manifestPath = join(NEXT_DIR, 'build-manifest.json')
  if (!existsSync(manifestPath)) {
    process.stderr.write(
      `[check-bundle-size] ${manifestPath} not found — run \`bun run --filter @kuruma/web build\` first\n`,
    )
    return 1
  }

  const manifest: BuildManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const shared = sharedFirstLoadFiles(manifest)
  const result = checkBudget(sumBytes(shared, NEXT_DIR))
  const total = totalChunkBytes(NEXT_DIR)
  const delta = formatKb(Math.abs(result.bytes - result.budgetBytes))
  const verdict = result.overBudget ? `OVER by ${delta}` : `under by ${delta}`

  process.stdout.write(
    `[check-bundle-size] shared first-load JS: ${formatKb(result.bytes)} ` +
      `(budget ${formatKb(result.budgetBytes)}) — ${verdict}\n`,
  )
  process.stdout.write(`[check-bundle-size] total client JS: ${formatKb(total)} (informational)\n`)
  process.stdout.write(
    '[check-bundle-size] note: Next 16 Turbopack emits no per-route First Load JS; ' +
      'this gates the shared baseline every renter route pays. Per-route deltas = follow-up.\n',
  )
  return result.overBudget ? 1 : 0
}

if (import.meta.main) {
  process.exit(main())
}
