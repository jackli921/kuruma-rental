// .lintstagedrc.cjs
module.exports = {
  '*.{ts,tsx}': (stagedFiles) => {
    // biome check receives the staged files so it only checks what's changed
    const biomeCmd = `bunx biome check --no-errors-on-unmatched ${stagedFiles.join(' ')}`
    // whole-tree commands ignore the file list
    return [
      biomeCmd,
      'bun run scripts/lint-file-size.ts',
      'bun run scripts/lint-module-boundaries.ts',
      'bunx tsc --noEmit -p packages/web/tsconfig.json',
      'bunx tsc --noEmit -p packages/api/tsconfig.json',
    ]
  },
}
