#!/usr/bin/env bun
import { Glob } from 'bun'

/**
 * The Next.js App Router tree (packages/web/src/app/) was deleted in #704; the
 * live app is Vite + TanStack Router (packages/web/src/routes/ + vite/).
 * Nothing belongs under src/app/ anymore. This guard fails CI if that frozen
 * tree starts regrowing, so the #689 dead-code cleanup can't be silently
 * re-accumulated by an "edit the wrong copy" mistake.
 */
const FROZEN_ROOT = 'packages/web/src/app'

const SOURCE_GLOB = '**/*.{ts,tsx}'

export function findFrozenFiles(root: string = FROZEN_ROOT): string[] {
  const glob = new Glob(SOURCE_GLOB)
  try {
    return Array.from(glob.scanSync({ cwd: root, onlyFiles: true }), (rel) => `${root}/${rel}`)
  } catch {
    // A missing directory is the desired post-#704 state: nothing has regrown.
    return []
  }
}

function main(): number {
  const files = findFrozenFiles()
  if (files.length === 0) return 0

  for (const file of files) {
    process.stderr.write(`[lint-no-next-app] ERROR ${file}\n`)
  }
  process.stderr.write(
    `[lint-no-next-app] ${files.length} file(s) under ${FROZEN_ROOT}/ — the Next App Router tree was removed in #704. Build under packages/web/src/routes/ + vite/ instead.\n`,
  )
  return 1
}

if (import.meta.main) {
  process.exit(main())
}
