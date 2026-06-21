// ENFORCES: @kuruma/shared/* import paths must match packages/shared/package.json "exports"
// SSOT: code-only — rule undocumented, see #1015
/**
 * Detects import paths into @kuruma/shared that have no matching entry
 * in packages/shared/package.json "exports". Bun workspace mode resolves
 * these via filesystem fallback, but stricter bundlers or non-workspace
 * consumers would fail. See the "Workspace Fallback Masking Missing
 * Exports" lesson in the code review deep dive (2026-04-12).
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkgJson = JSON.parse(readFileSync('packages/shared/package.json', 'utf-8'))
const exportKeys = new Set(
  Object.keys(pkgJson.exports ?? {})
    .filter((k) => k !== '.')
    .map((k) => k.replace(/^\.\//, '')),
)

// Find all @kuruma/shared/* imports across api and web source files
const grepOutput = execSync(
  `grep -rh "@kuruma/shared/" packages/api/src packages/web/src --include="*.ts" --include="*.tsx" 2>/dev/null || true`,
  { encoding: 'utf-8' },
)

const importPaths = new Set<string>()
for (const line of grepOutput.split('\n')) {
  const match = line.match(/'@kuruma\/shared\/([^']+)'/)
  if (match?.[1]) importPaths.add(match[1])
}

const missing = [...importPaths].filter((p) => !exportKeys.has(p)).sort()

if (missing.length > 0) {
  console.error('Export drift detected in packages/shared/package.json:')
  console.error('')
  for (const p of missing) {
    console.error(`  MISSING EXPORT: "./${p}" is imported but has no exports entry`)
  }
  console.error('')
  console.error('Fix: add the missing entries to packages/shared/package.json "exports"')
  process.exit(1)
} else {
  console.log(`Export drift check passed (${importPaths.size} import paths, all exported)`)
}
