#!/usr/bin/env bun
// ENFORCES: the Vite/CF Pages SPA bundle stays under the 2 MiB gzipped budget
// SSOT: docs/plans/2026-06-09-378-pages-cutover.md § 1. Context
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { Glob } from 'bun'

// Vite/CF Pages target. The migration's whole reason for being is permanent
// headroom under CF's free tier, so the gzipped output must stay well under the
// 2 MiB budget (spec §acceptance). Tighten later as the bundle stabilizes.
const DIST_DIR = 'packages/web/dist'
const BUDGET_BYTES = 2 * 1024 * 1024

export interface AssetSize {
  file: string
  gzipBytes: number
}

export interface SizeReport {
  assets: AssetSize[]
  totalGzipBytes: number
  budgetBytes: number
  overBudget: boolean
}

/**
 * Pure: gzip each file's bytes and sum, largest-first. Content is supplied by the
 * caller (not read here) so the budget math is unit-testable without a real build.
 * Each file's gzip size matches what `vite build` prints per chunk, so a regression
 * points straight at a chunk in the build log. The *sum* is a conservative proxy
 * for the deploy footprint (per-file gzip overcounts vs one stream), not the exact
 * over-the-wire transfer — fine for a budget, where erring high fails earlier.
 */
export function measureGzip(
  files: ReadonlyArray<{ file: string; content: Uint8Array }>,
  budgetBytes: number = BUDGET_BYTES,
): SizeReport {
  const assets = files
    .map(({ file, content }) => ({ file, gzipBytes: gzipSync(content).length }))
    .sort((a, b) => b.gzipBytes - a.gzipBytes)
  const totalGzipBytes = assets.reduce((sum, a) => sum + a.gzipBytes, 0)
  return { assets, totalGzipBytes, budgetBytes, overBudget: totalGzipBytes > budgetBytes }
}

export function discoverDist(dir: string = DIST_DIR): { file: string; content: Uint8Array }[] {
  const glob = new Glob('**/*')
  const out: { file: string; content: Uint8Array }[] = []
  for (const rel of glob.scanSync({ cwd: dir, onlyFiles: true })) {
    out.push({ file: `${dir}/${rel}`, content: readFileSync(`${dir}/${rel}`) })
  }
  return out
}

function formatKib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

function main(): number {
  const files = discoverDist()
  if (files.length === 0) {
    process.stderr.write(
      `[lint-dist-size] no files under ${DIST_DIR} — run \`bun run --filter @kuruma/web build\` first\n`,
    )
    return 1
  }

  const report = measureGzip(files)
  const pct = ((report.totalGzipBytes / report.budgetBytes) * 100).toFixed(1)
  process.stdout.write(
    `[lint-dist-size] ${formatKib(report.totalGzipBytes)} gzipped across ${files.length} files ` +
      `(${pct}% of ${formatKib(report.budgetBytes)} budget)\n`,
  )
  for (const asset of report.assets.slice(0, 5)) {
    process.stdout.write(`  ${formatKib(asset.gzipBytes)}  ${asset.file}\n`)
  }

  if (report.overBudget) {
    const over = report.totalGzipBytes - report.budgetBytes
    process.stderr.write(`[lint-dist-size] ERROR over budget by ${formatKib(over)}\n`)
    return 1
  }
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
