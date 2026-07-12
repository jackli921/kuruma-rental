import { expect, test } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './constants'
import { testSql } from './pg'

// #1539: authenticated, real-DB coverage for the platform-admin operator teardown lever —
// deactivate (pause) then reactivate (restore) an operator from the admin directory. Drives
// the real Vite UI -> Hono API -> seeded Postgres stack under the PLATFORM_ADMIN session.
// The onboarding chain (apply -> approve -> invite) is covered by operator-onboarding; this
// is the missing teardown half.
//
// What this proves (the deactivate/reactivate handlers + directory UI are otherwise only
// unit-covered):
//   - The admin opens /admin/operators and sees the directory.
//   - One-click Deactivate flips the row to "Deactivated" and stamps operators.deactivatedAt.
//   - One-click Reactivate flips it back to "Active" and clears deactivatedAt.
//
// Fixture: a THROWAWAY operator created directly over pg, so the round-trip never touches a
// real seeded operator that another spec depends on (tenant-isolation leans on Kansai Drive).
// deactivate/reactivate only toggle operators.deactivatedAt (routes/admin-operators.ts), which
// needs no owner/vehicles, so a bare operator row exercises the full path. Swept by name prefix
// in afterAll — which also satisfies "no operator left deactivated" (the row is gone).

// The platform-admin view (demo-walkthrough / ga-flag-flip pattern).
test.use({ storageState: ADMIN_STORAGE_STATE })

// Unique-enough prefix so afterAll can sweep this spec's operators (incl. a zombie from a
// killed run) without touching seeded operators.
const OP_NAME_PREFIX = 'E2E Lifecycle '

test.describe('platform-admin operator lifecycle — deactivate + reactivate (real DB)', () => {
  test.afterAll(cleanupSeededOperators)

  test('admin pauses an operator and restores it; status + deactivatedAt round-trip', async ({
    page,
  }) => {
    test.setTimeout(120_000) // Vite builds the /admin/operators route on first hit.

    const { operatorId, operatorName } = await seedThrowawayOperator()

    await page.goto('/en/admin/operators')
    const row = page.getByRole('row').filter({ hasText: operatorName })
    // Generous: Vite lazily compiles the /admin/operators route on the first hit.
    await expect(row).toBeVisible({ timeout: 30_000 })
    // Starts active: the Active pill shows and the toggle offers Deactivate.
    await expect(row.getByText('Active', { exact: true })).toBeVisible()
    expect(await readDeactivatedAt(operatorId)).toBeNull()

    await test.step('deactivate -> Deactivated + deactivatedAt set', async () => {
      await row.getByRole('button', { name: 'Deactivate' }).click()
      // The pill flips only after the write succeeds and the directory refetches, so its
      // appearance means the server persisted the change.
      await expect(row.getByText('Deactivated', { exact: true })).toBeVisible()
      await expect(row.getByRole('button', { name: 'Reactivate' })).toBeVisible()
      expect(await readDeactivatedAt(operatorId)).not.toBeNull()
    })

    await test.step('reactivate -> Active + deactivatedAt cleared', async () => {
      await row.getByRole('button', { name: 'Reactivate' }).click()
      await expect(row.getByText('Active', { exact: true })).toBeVisible()
      await expect(row.getByRole('button', { name: 'Deactivate' })).toBeVisible()
      expect(await readDeactivatedAt(operatorId)).toBeNull()
    })
  })
})

// --- seeding + assertion helpers (raw pg over testSql) -------------------------------------

/** A bare operator (no owner/vehicles) — enough for the directory to list it (fleetCount
 *  falls back to 0) and the deactivate/reactivate toggle to flip operators.deactivatedAt.
 *  MUST stay childless so cleanupSeededOperators can plain-delete it under the FK restrict. */
async function seedThrowawayOperator(): Promise<{ operatorId: string; operatorName: string }> {
  const sql = testSql()
  try {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase()
    const operatorId = crypto.randomUUID()
    const operatorName = `${OP_NAME_PREFIX}${suffix}`
    const slug = `e2e-lifecycle-${suffix.toLowerCase()}`
    // id is app-defaulted ($defaultFn), which does NOT fire on a raw pg insert, so set it
    // explicitly; slug/name are required; createdAt/updatedAt/deactivatedAt are DB-defaulted.
    await sql`INSERT INTO operators ${sql({ id: operatorId, slug, name: operatorName })}`
    return { operatorId, operatorName }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function readDeactivatedAt(operatorId: string): Promise<Date | null> {
  const sql = testSql()
  try {
    const [row] = await sql<{ deactivatedAt: Date | null }[]>`
      SELECT "deactivatedAt" FROM operators WHERE id = ${operatorId}`
    if (!row) throw new Error(`operator ${operatorId} not found`)
    return row.deactivatedAt
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** Remove every operator this spec created (by name prefix) — also self-heals a zombie from
 *  a killed run and guarantees none is left deactivated (the row is gone). The throwaway has
 *  no FK children, so a plain delete is safe. */
async function cleanupSeededOperators(): Promise<void> {
  const sql = testSql()
  try {
    await sql`DELETE FROM operators WHERE name LIKE ${`${OP_NAME_PREFIX}%`}`
  } finally {
    await sql.end({ timeout: 5 })
  }
}
