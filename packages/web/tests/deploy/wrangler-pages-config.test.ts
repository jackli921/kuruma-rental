import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

// Drift guard for the CF Pages cutover (#378 §7.5). The Pages deploy is wired
// across files that MUST agree: the web package.json scripts (`deploy:pages` +
// `pages:create-project`), deploy.yml (which calls the deploy script and drops
// the frozen Worker block), and vite.config.mts (the build output dir). A
// mismatch ships a deploy that targets the wrong project/output, or a project
// missing the proxy's compat flags — invisible until #304 lets us run it live.
// This makes that drift fail in CI instead.
//
// Note: `wrangler pages deploy` has no --config flag and only auto-discovers a
// file named wrangler.jsonc (here the frozen Worker config, warned-and-ignored),
// so the Pages project's compat flags + API_ORIGIN are applied once at #304 via
// `pages:create-project` + `wrangler pages secret put`, not a config file.

const WEB_ROOT = process.cwd() // vitest runs with cwd = packages/web
const DEPLOY_YML = path.join(WEB_ROOT, '..', '..', '.github', 'workflows', 'deploy.yml')

const PROJECT_NAME = 'kuruma-web-pages'
const OUTPUT_DIR = 'dist'
const REQUIRED_COMPAT_FLAGS = ['nodejs_compat', 'global_fetch_strictly_public'] as const

const pkg = JSON.parse(readFileSync(path.join(WEB_ROOT, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
}
const scripts = pkg.scripts ?? {}
const deployYml = readFileSync(DEPLOY_YML, 'utf8')

const deployScript = scripts['deploy:pages'] ?? ''
const createScript = scripts['pages:create-project'] ?? ''

describe('deploy:pages script', () => {
  test('deploys the Vite output dir to the kuruma-web-pages project', () => {
    expect(deployScript).toContain(`wrangler pages deploy ${OUTPUT_DIR}`)
    expect(deployScript).toContain(`--project-name=${PROJECT_NAME}`)
  })

  test('does NOT pass --config (unsupported by `wrangler pages deploy`)', () => {
    expect(deployScript).not.toContain('--config')
  })

  test('deploys to the branch that create-project declares as production', () => {
    // A production deploy requires --branch to equal create-project's
    // --production-branch. If they drift, deploys silently publish previews
    // (<branch>.kuruma-web-pages.pages.dev) and the apex smoke test goes stale.
    expect(deployScript).toContain('--branch=production')
    expect(createScript).toContain('--production-branch=production')
  })
})

describe('pages:create-project script (one-time #304 setup, config-as-code)', () => {
  test('creates the same project name', () => {
    expect(createScript).toContain(`wrangler pages project create ${PROJECT_NAME}`)
  })

  test('sets the compat flags the proxy Functions need', () => {
    // global_fetch_strictly_public forces the proxy Function's fetch() to the API
    // Worker over the public internet; without it CF short-circuits the inter-
    // Worker fetch and returns 404 (the exact bug the Worker hit). See #304.
    for (const flag of REQUIRED_COMPAT_FLAGS) {
      expect(createScript).toContain(`--compatibility-flag=${flag}`)
    }
  })
})

describe('deploy.yml ↔ scripts agree (one active web path)', () => {
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

  test('enforces the dist-size budget before deploying', () => {
    expect(deployYml).toContain('lint:dist-size')
  })

  test('smoke-tests the proxy seam, not just the static shell', () => {
    // A missing API_ORIGIN ships green if the smoke only hits /en (static).
    // Crossing /api/health proves API_ORIGIN is set and the upstream reachable.
    expect(deployYml).toContain('$WEB_PAGES_URL/api/health')
  })
})

describe('vite.config.mts ↔ deploy output dir agree', () => {
  test('vite build outDir matches the deployed dir', () => {
    const viteConfig = readFileSync(path.join(WEB_ROOT, 'vite.config.mts'), 'utf8')
    expect(viteConfig).toContain(`outDir: '${OUTPUT_DIR}'`)
  })
})
