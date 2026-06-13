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

async function capture(
  page: Page,
  name: string,
  url: string,
  readySelector = 'main h1, h1',
): Promise<void> {
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
    // the page's ready-selector (its <h1> by default) to mount before judging it
    // blank — networkidle alone races the compile + first cold-pool DB round-trip.
    // Pages without an <h1> (e.g. the trip-detail page) pass their own selector.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    headingRendered = await page
      .locator(readySelector)
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false)
    await page.waitForTimeout(500)
  } catch (e) {
    pageErrors.push(`goto failed: ${(e as Error).message}`.slice(0, 300))
  }
  if (!headingRendered)
    pageErrors.push(`NO "${readySelector}" rendered within 20s (blank/stuck page)`)

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

// The detail pages (#527 vehicle-detail, #610 trip-detail) are keyed by a UUID.
// Read a REAL id from the same tenant-scoped API the list pages use — over the
// operator session, through the /api proxy, so the id belongs to this tenant and
// the tenant-scoped detail route resolves (a hardcoded UUID would rot when the
// seed re-mints ids, and a foreign id would 404). Returns null only if the seed
// gave this operator zero rows; the caller asserts that loudly rather than skip.
async function firstId(page: Page, apiPath: string): Promise<string | null> {
  const res = await page.request.get(apiPath)
  if (!res.ok()) return null
  const body = (await res.json()) as { data?: Array<{ id?: string }> }
  return body.data?.[0]?.id ?? null
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
    // #527 — vehicle-detail (calendar-lite + utilization). Operator session;
    // fleet-overview is tenant-scoped since #594, so the first row is this
    // operator's own car.
    const vehicleId = await firstId(page, '/api/vehicles/fleet-overview')
    expect(vehicleId, 'seed must provide an operator vehicle for #527 detail').toBeTruthy()
    if (vehicleId) await capture(page, '03b-op-vehicle-detail', `/en/manage/fleet/${vehicleId}`)

    await capture(page, '04-op-bookings', '/en/manage/bookings')

    // #610 — operator trip-detail page (hosts the substitution UI). Keyed by a
    // real booking id from the tenant-scoped GET /bookings.
    const bookingId = await firstId(page, '/api/bookings?expand=renter&limit=1')
    expect(bookingId, 'seed must provide an operator booking for #610 trip-detail').toBeTruthy()
    // This page has no <h1> — the booking code is a <p> and the timeline heading
    // is an <h2>. Wait on that <h2> instead of the default h1 ready-selector.
    if (bookingId)
      await capture(page, '04b-op-trip-detail', `/en/manage/bookings/${bookingId}`, 'main h2')

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
