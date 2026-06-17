import { expect, test } from '@playwright/test'
import { OPERATOR_SEED_EMAIL } from './constants'
import { testSql } from './pg'

// #903: authenticated, real-DB coverage for the operator settings page. The
// minted session cookie (auth.setup.ts) is the Best Car Rental OWNER, so this
// exercises the real web -> Hono PATCH /operators/:id -> seeded Neon branch.
//
// The owner persona is scoped to a SHARED seeded operator, so we capture its
// original profile in beforeAll and restore it in afterAll — otherwise renaming
// it would leak "Best Car Rental" out from under every other spec (workers: 1,
// so the restore lands before the next file runs).
test.describe('operator settings (authenticated, real DB)', () => {
  let original: { id: string; name: string; preAuthHandoffUrl: string | null }

  test.beforeAll(async () => {
    const sql = testSql()
    try {
      const rows = await sql<{ id: string; name: string; preAuthHandoffUrl: string | null }[]>`
        SELECT o.id, o.name, o.pre_auth_handoff_url AS "preAuthHandoffUrl"
        FROM operators o
        JOIN users u ON u."operatorId" = o.id
        WHERE u.email = ${OPERATOR_SEED_EMAIL}
        LIMIT 1`
      const row = rows[0]
      if (!row)
        throw new Error(`No operator for ${OPERATOR_SEED_EMAIL} — seed the e2e branch first`)
      original = row
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  test.afterAll(async () => {
    const sql = testSql()
    try {
      await sql`
        UPDATE operators
        SET name = ${original.name},
            pre_auth_handoff_url = ${original.preAuthHandoffUrl},
            "updatedAt" = now()
        WHERE id = ${original.id}`
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  test('owner edits business name + payment handoff URL and it round-trips (P1)', async ({
    page,
  }) => {
    const newName = `E2E Settings ${Date.now()}`
    const newUrl = `https://pay.e2e.example/${Date.now()}`

    await page.goto('/en/manage/settings')
    // The operator session is honoured — no redirect to sign-in.
    await expect(page).toHaveURL(/\/en\/manage\/settings\/?$/)

    // Prefilled with the current profile; the handoff field is editable for an owner.
    await expect(page.locator('#settings-name')).toHaveValue(original.name)
    const handoff = page.locator('#settings-handoff')
    await expect(handoff).toBeEnabled()

    await page.locator('#settings-name').fill(newName)
    await handoff.fill(newUrl)
    await page.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByText('Settings saved.')).toBeVisible()

    // Persisted through the API to the DB (not just an optimistic UI update).
    const sql = testSql()
    try {
      const rows = await sql<{ name: string; preAuthHandoffUrl: string | null }[]>`
        SELECT name, pre_auth_handoff_url AS "preAuthHandoffUrl"
        FROM operators WHERE id = ${original.id} LIMIT 1`
      expect(rows[0]?.name).toBe(newName)
      expect(rows[0]?.preAuthHandoffUrl).toBe(newUrl)
    } finally {
      await sql.end({ timeout: 5 })
    }
  })
})
