import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

// Drift guard for the CF Pages cutover (#378 §7.5). The Pages deploy is wired
// across three files that MUST agree: wrangler.pages.jsonc (project + Functions
// env), deploy.yml (the `wrangler pages deploy` flags), and vite.config.mts
// (the build output dir). A mismatch ships a deploy that targets the wrong
// project, output, or API origin — invisible until #304 lets us run it live.
// This test makes that drift fail in CI instead.

const WEB_ROOT = process.cwd() // vitest runs with cwd = packages/web
const CONFIG_PATH = path.join(WEB_ROOT, 'wrangler.pages.jsonc')
const DEPLOY_YML = path.join(WEB_ROOT, '..', '..', '.github', 'workflows', 'deploy.yml')
const VITE_CONFIG = path.join(WEB_ROOT, 'vite.config.mts')

const PROJECT_NAME = 'kuruma-web-pages'
const OUTPUT_DIR = 'dist'

// Strip line-leading `//` comments and block comments so the JSONC parses as
// JSON. Only whole comment lines are removed, so a `https://` inside a value
// (never line-leading) survives.
function parseJsonc(source: string): unknown {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const noLineComments = noBlocks
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
  return JSON.parse(noLineComments)
}

const config = parseJsonc(readFileSync(CONFIG_PATH, 'utf8')) as {
  name?: string
  pages_build_output_dir?: string
  compatibility_flags?: string[]
  vars?: Record<string, string>
}

describe('wrangler.pages.jsonc', () => {
  test('targets the kuruma-web-pages Pages project', () => {
    expect(config.name).toBe(PROJECT_NAME)
  })

  test('serves the Vite build output dir', () => {
    expect(config.pages_build_output_dir).toBe(OUTPUT_DIR)
  })

  test('enables nodejs_compat and global_fetch_strictly_public for the proxy Functions', () => {
    // global_fetch_strictly_public forces the proxy Function's fetch() to the API
    // Worker over the public internet; without it CF short-circuits the inter-
    // Worker fetch and returns 404 (the exact bug the Worker hit). See #304.
    expect(config.compatibility_flags).toEqual(
      expect.arrayContaining(['nodejs_compat', 'global_fetch_strictly_public']),
    )
  })

  test('sets API_ORIGIN to the API Worker URL the proxy forwards to', () => {
    expect(config.vars?.API_ORIGIN).toMatch(/^https:\/\/kuruma-api\..*\.workers\.dev$/)
  })

  test('does NOT set VITE_API_BASE_URL — client must fall back to the same-origin /api proxy', () => {
    // Spec §5.5: same-origin keeps the session cookie SameSite=Lax (Safari-safe).
    // A baked VITE_API_BASE_URL would point the browser straight at the API and
    // defeat the proxy. Belongs nowhere in the Pages build env.
    expect(config.vars?.VITE_API_BASE_URL).toBeUndefined()
  })
})

describe('deploy:pages script ↔ Pages config agree (no drift)', () => {
  const pkg = JSON.parse(readFileSync(path.join(WEB_ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  const deployScript = pkg.scripts?.['deploy:pages'] ?? ''

  test('deploy:pages targets the same project, output dir, and Pages config', () => {
    expect(deployScript).toContain(`--project-name=${PROJECT_NAME}`)
    expect(deployScript).toContain(`wrangler pages deploy ${OUTPUT_DIR}`)
    expect(deployScript).toContain('--config wrangler.pages.jsonc')
  })
})

describe('deploy.yml ↔ deploy:pages agree (one active web path)', () => {
  const deployYml = readFileSync(DEPLOY_YML, 'utf8')

  test('CI deploys via the deploy:pages script (single source of truth)', () => {
    expect(deployYml).toContain('bun run deploy:pages')
  })

  test('the frozen opennext Worker deploy block is gone', () => {
    // §5: dead `if:false` deploy steps beside the live path are a footgun.
    expect(deployYml).not.toContain('Deploy Web Worker')
    expect(deployYml).not.toContain('WEB_WORKER_URL')
  })

  test('the Pages deploy + smoke are guarded against a pre-#304 manual dispatch', () => {
    expect(deployYml).toContain("vars.WEB_PAGES_DEPLOY_ENABLED == 'true'")
  })
})

describe('vite.config.mts ↔ Pages config agree', () => {
  test('vite build outDir matches pages_build_output_dir', () => {
    const viteConfig = readFileSync(VITE_CONFIG, 'utf8')
    expect(viteConfig).toContain(`outDir: '${OUTPUT_DIR}'`)
  })
})
