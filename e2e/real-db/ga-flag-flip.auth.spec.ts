import { expect, test } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './constants'
import { testSql } from './pg'

// GA flag-flip smoke (path-to-GA #1476, Q4): prove the runtime override control plane
// works end to end — a platform admin toggles a flag in the real switchboard, a DB
// override row is written, GET /feature-flags serves it, and the app honors it with NO
// rebuild/redeploy. This is the exact go-live action, and the regression class #1479
// fixed (a consumer that reads the build-time env and ignores the override).
//
// The real-db lane bakes every flag ON via build-time VITE_FEATURE_ENV
// (playwright.real-db.config.ts), so the faithful, no-extra-server proof is the OFF
// direction: override the flag OFF and assert the normally-on behavior disappears —
// which can only happen if the app reads the override, not the baked-in env.
//
// Two consumers, two tests, because the app reads flags by different mechanisms (#1486):
//   1. the provider useFeatureFlag hook (live render) — FLEET_TIMELINE gates the
//      "Timeline" option in the operator calendar view switcher; asserted via a reload.
//   2. a route beforeLoad GATE (fetchQuery) — OPERATOR_TEAM guards /manage/team and
//      redirects when off; asserted via a hard goto. This is the path plain
//      ensureQueryData left override-blind (it served the seeded build-time default).
// The switch's accessible name is "Toggle <registry label>" (admin.featureFlags.toggleLabel).
const FLAG = 'FLEET_TIMELINE'
const FLAG_LABEL = 'Fleet timeline board'
const GATE_FLAG = 'OPERATOR_TEAM'
const GATE_FLAG_LABEL = 'Operator team management'
const BOOKINGS_WEEK = '/en/manage/bookings?view=week'
const TEAM = '/en/manage/team'
const SWITCHBOARD = '/en/admin/feature-flags'
const OVERRIDDEN_FLAGS = [FLAG, GATE_FLAG] as const

// Each override is a single GLOBAL row on the shared Neon branch, which every serial
// real-db spec reads (effective = override ?? build-time). Delete them so a flip can
// never leak into another spec. Runs before (clean baseline) and after (no residue)
// every test, and in afterEach even when an assertion throws mid-flip.
async function clearOverrides(): Promise<void> {
  const sql = testSql()
  try {
    for (const key of OVERRIDDEN_FLAGS) {
      await sql`DELETE FROM feature_flags WHERE key = ${key}`
    }
  } finally {
    await sql.end()
  }
}

test.describe('GA flag-flip smoke', () => {
  test.beforeEach(clearOverrides)
  test.afterEach(clearOverrides)

  test('a platform-admin switchboard toggle flips FLEET_TIMELINE for an operator live, no redeploy', async ({
    page, // the OPERATOR_OWNER project default — the observer
    browser,
  }) => {
    const timelineOption = page.getByRole('button', { name: 'Timeline' })

    // Baseline: build-time ON, no override -> the operator's switcher offers Timeline.
    await page.goto(BOOKINGS_WEEK)
    await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible()
    await expect(timelineOption).toBeVisible()

    // A platform admin flips the override in the REAL switchboard (its own session).
    const adminContext = await browser.newContext({ storageState: ADMIN_STORAGE_STATE })
    try {
      const admin = await adminContext.newPage()
      await admin.goto(SWITCHBOARD)
      const toggle = admin.getByRole('switch', { name: `Toggle ${FLAG_LABEL}` })
      await expect(toggle).toBeChecked() // effective = build-time ON, no override yet

      await test.step('toggle OFF hides the option live for the operator', async () => {
        await toggle.click() // PATCH /admin/feature-flags/FLEET_TIMELINE {enabled:false}
        await expect(toggle).not.toBeChecked() // mutation resolved + ['feature-flags'] refetched

        // The operator UI reconciles to the override on reload. A consumer still reading
        // the build-time env (the #1479 bug) would keep the option -> this assertion fails.
        await page.reload()
        await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible()
        await expect(timelineOption).toBeHidden()
      })

      await test.step('toggle back ON restores the option (the flip reverses)', async () => {
        await toggle.click()
        await expect(toggle).toBeChecked()
        await page.reload()
        await expect(timelineOption).toBeVisible()
      })
    } finally {
      await adminContext.close()
    }
  })

  test('a switchboard toggle gates a beforeLoad-guarded route on a hard load, no redeploy', async ({
    page, // OPERATOR_OWNER — reaches its own /manage/team while the flag is on
    browser,
  }) => {
    // Baseline: build-time ON, no override -> the gated route admits (no redirect).
    await page.goto(TEAM)
    await expect(page).toHaveURL(/\/manage\/team/)

    const adminContext = await browser.newContext({ storageState: ADMIN_STORAGE_STATE })
    try {
      const admin = await adminContext.newPage()
      await admin.goto(SWITCHBOARD)
      const toggle = admin.getByRole('switch', { name: `Toggle ${GATE_FLAG_LABEL}` })
      await expect(toggle).toBeChecked() // effective = build-time ON, no override yet

      await test.step('override OFF redirects the gated route on a fresh hard load', async () => {
        await toggle.click() // PATCH /admin/feature-flags/OPERATOR_TEAM {enabled:false}
        await expect(toggle).not.toBeChecked() // mutation resolved + DB row written

        // A HARD load (fresh queryClient): beforeLoad fetchQuery()s the real override
        // instead of the seeded build-time default that ensureQueryData returned. A gate
        // still on ensureQueryData (the #1486 bug) would admit the closed route -> no
        // redirect -> this assertion fails.
        await page.goto(TEAM)
        await expect(page).toHaveURL(/\/manage\/bookings/)
      })

      await test.step('override back ON re-admits the route (the flip reverses)', async () => {
        await toggle.click()
        await expect(toggle).toBeChecked()
        await page.goto(TEAM)
        await expect(page).toHaveURL(/\/manage\/team/)
      })
    } finally {
      await adminContext.close()
    }
  })
})
