import { mkdirSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { RENTER_STORAGE_STATE } from './constants'

// Dev-only console noise that is never a demo defect — exclude so the gate stays
// mutation-resistant (fails on real regressions, not React/Vite chatter).
const BENIGN_CONSOLE = [
  'Download the React DevTools',
  'react-devtools',
  '[vite]',
  'router devtools',
]

// #509 demo walkthrough — drives EVERY shipped renter + operator page against the
// real Vite -> Hono -> seeded-Postgres stack and captures what a human reviewer
// would see: HTTP 4xx/5xx on /api or /auth (the operator fleet-scope 403s of
// #594/#598/#607), use-intl MISSING_MESSAGE console errors (dropped keys after
// the ~30-PR merge), uncaught page errors, and guard redirects (a wrong-role
// bounce to the landing page). Screenshots land in e2e/.demo-screens/ as the
// evidence; the JSON summary is the audit trail. Soft assertions make it a real
// regression gate that still walks + screenshots EVERY page, then reports all
// problems at once instead of aborting on the first.

const SHOTS_DIR = 'e2e/.demo-screens'

interface PageFinding {
  name: string
  requestedUrl: string
  finalUrl: string
  redirected: boolean
  httpErrors: string[]
  consoleErrors: string[]
  pageErrors: string[]
}

const findings: PageFinding[] = []

async function capture(page: Page, name: string, url: string): Promise<void> {
  const httpErrors: string[] = []
  const consoleErrors: string[] = []
  const pageErrors: string[] = []

  const onResponse = (res: {
    status(): number
    url(): string
    request(): { method(): string }
  }) => {
    const status = res.status()
    const u = res.url()
    if (status >= 400 && (u.includes('/api') || u.includes('/auth') || u.includes(':8788'))) {
      httpErrors.push(`${status} ${res.request().method()} ${u.replace(/^https?:\/\/[^/]+/, '')}`)
    }
  }
  const onConsole = (msg: { type(): string; text(): string }) => {
    const text = msg.text()
    if (BENIGN_CONSOLE.some((b) => text.includes(b))) return
    if (
      msg.type() === 'error' ||
      text.includes('MISSING_MESSAGE') ||
      text.includes('INVALID_MESSAGE')
    ) {
      consoleErrors.push(text.slice(0, 300))
    }
  }
  const onPageError = (err: Error) => pageErrors.push(`${err.message}`.slice(0, 300))

  page.on('response', onResponse)
  page.on('console', onConsole)
  page.on('pageerror', onPageError)

  let headingRendered = false
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    // Let route-level lazy chunks + react-query fetches settle. On a cold Vite
    // dev server the FIRST route hit compiles its chunk on demand, so wait for
    // the page's own <h1> to mount before judging it blank — networkidle alone
    // races the compile + first cold-pool DB round-trip.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    headingRendered = await page
      .locator('main h1, h1')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false)
    await page.waitForTimeout(500)
  } catch (e) {
    pageErrors.push(`goto failed: ${(e as Error).message}`.slice(0, 300))
  }
  if (!headingRendered) pageErrors.push('NO <h1> rendered within 20s (blank/stuck page)')

  const finalUrl = page.url().replace(/^https?:\/\/[^/]+/, '')
  await page.screenshot({ path: `${SHOTS_DIR}/${name}.png`, fullPage: true }).catch(() => {})

  page.off('response', onResponse)
  page.off('console', onConsole)
  page.off('pageerror', onPageError)

  const finding: PageFinding = {
    name,
    requestedUrl: url,
    finalUrl,
    redirected: !finalUrl.startsWith(url),
    httpErrors: [...new Set(httpErrors)],
    consoleErrors: [...new Set(consoleErrors)],
    pageErrors: [...new Set(pageErrors)],
  }
  findings.push(finding)

  // Soft so one bad page never aborts the walkthrough — every page is still
  // visited + screenshotted, and the test reports ALL problems at the end.
  expect.soft(finding, `${name} must render clean (no guard redirect)`).toMatchObject({
    redirected: false,
  })
  expect.soft(finding.httpErrors, `${name} hit /api 4xx/5xx (e.g. operator 403)`).toEqual([])
  expect.soft(finding.consoleErrors, `${name} console errors (e.g. missing i18n key)`).toEqual([])
  expect.soft(finding.pageErrors, `${name} blank/stuck or threw`).toEqual([])
}

test.describe('#509 demo walkthrough — capture every page', () => {
  test.afterAll(() => {
    mkdirSync(SHOTS_DIR, { recursive: true })
    writeFileSync(`${SHOTS_DIR}/findings.json`, JSON.stringify(findings, null, 2))
    // Surface in the Playwright run log so the verdict is readable without the file.
    for (const f of findings) {
      const flags: string[] = []
      if (f.redirected) flags.push(`REDIRECT->${f.finalUrl}`)
      if (f.httpErrors.length) flags.push(`HTTP[${f.httpErrors.join(' | ')}]`)
      if (f.consoleErrors.length) flags.push(`CONSOLE[${f.consoleErrors.length}]`)
      if (f.pageErrors.length) flags.push(`PAGEERR[${f.pageErrors.length}]`)
      // biome-ignore lint/suspicious/noConsole: this IS the report output
      console.log(
        `[walkthrough] ${flags.length ? '⚠️ ' : '✅ '}${f.name} -> ${f.finalUrl} ${flags.join(' ')}`,
      )
      for (const c of f.consoleErrors) console.log(`    console: ${c}`)
      for (const p of f.pageErrors) console.log(`    pageerror: ${p}`)
    }
  })

  test('operator portal — every page renders without 403/missing-key', async ({ page }) => {
    test.setTimeout(180_000)
    mkdirSync(SHOTS_DIR, { recursive: true })
    await capture(page, '01-op-dashboard', '/en/dashboard')
    await capture(page, '02-op-fleet-rows', '/en/manage/fleet')
    // Grid toggle is a localStorage-backed button; click it if present, re-shoot.
    const gridBtn = page.getByRole('button', { name: /grid/i }).first()
    if (await gridBtn.isVisible().catch(() => false)) {
      await gridBtn.click().catch(() => {})
      await page.waitForTimeout(800)
      await page
        .screenshot({ path: `${SHOTS_DIR}/03-op-fleet-grid.png`, fullPage: true })
        .catch(() => {})
    }
    await capture(page, '04-op-bookings', '/en/manage/bookings')
    await capture(page, '05-op-classes', '/en/manage/classes')
    await capture(page, '06-op-insurance', '/en/manage/insurance')
    await capture(page, '07-op-fees', '/en/manage/fees')
    await capture(page, '08-op-locations', '/en/manage/locations')
    await capture(page, '09-op-addons', '/en/manage/add-ons')
    // The page above renders "clean" even when the add-on list is empty (a 200
    // [] trips none of the soft checks). Assert a SEEDED row is actually shown:
    // every operator seeds a "Child seat" add-on, so this is session-agnostic.
    // This is the check that catches a demo-data-wired-but-not-displayed gap —
    // e.g. the real-api-server omitting addOnRepo and falling back to an empty
    // in-memory store while insurance (Drizzle-wired) rendered fine.
    await expect(page.getByText('Child seat').first()).toBeVisible()
  })

  test('renter surface — home, search, my bookings', async ({ browser, baseURL }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext({ storageState: RENTER_STORAGE_STATE, baseURL })
    const renter = await ctx.newPage()
    await capture(renter, '10-renter-home', '/en')
    await capture(renter, '11-renter-search', '/en/search')
    await capture(renter, '12-renter-mybookings', '/en/bookings')
    await ctx.close()
  })
})
