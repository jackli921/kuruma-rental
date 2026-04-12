// .lintstagedrc.cjs
module.exports = {
  '*.{ts,tsx}': (stagedFiles) => {
    // biome check receives the staged files so it only checks what's changed
    const biomeCmd = `bunx biome check --no-errors-on-unmatched ${stagedFiles.join(' ')}`
    // TODO: lint-file-size and lint-module-boundaries run whole-tree scans here
    // because they need to catch violations in files the staged change may
    // affect transitively. If pre-commit exceeds 5s as the codebase grows,
    // switch these to staged-only mode (both scripts' exported functions
    // already accept a file list) and rely on CI for whole-tree enforcement.
    return [
      biomeCmd,
      'bun run scripts/lint-file-size.ts',
      'bun run scripts/lint-module-boundaries.ts',
      'bunx tsc --noEmit -p packages/web/tsconfig.json',
      'bunx tsc --noEmit -p packages/api/tsconfig.json',
    ]
  },
}
