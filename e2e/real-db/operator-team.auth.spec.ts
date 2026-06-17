import { expect, test } from '@playwright/test'
import { OPERATOR_SEED_EMAIL } from './constants'
import { testSql } from './pg'

// #904: authenticated, real-DB coverage for the operator team page. The minted
// session (auth.setup.ts) is the Best Car Rental OWNER, so this drives the real
// web -> Hono POST /operators/me/invites -> seeded Neon branch. The invite is a
// NEW row this test owns, so afterEach deletes it by email (no shared-state
// restore needed, unlike operator-settings).
test.describe('operator team invites (authenticated, real DB)', () => {
  const email = `e2e-invite-${Date.now()}@example.test`

  test.afterEach(async () => {
    const sql = testSql()
    try {
      await sql`DELETE FROM provider_invites WHERE email = ${email}`
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  test('owner invites a staff member; the pending row appears and persists as OPERATOR_STAFF (P1)', async ({
    page,
  }) => {
    await page.goto('/en/manage/team')
    // The operator session is honoured — no redirect to sign-in.
    await expect(page).toHaveURL(/\/en\/manage\/team\/?$/)

    await page.getByRole('button', { name: 'Invite staff' }).click()
    await page.locator('#invite-email').fill(email)
    await page.getByRole('button', { name: 'Send invite' }).click()

    // Success reveal: the one-time invite URL is shown for the owner to copy.
    await expect(page.getByText('Invite created')).toBeVisible()
    const url = await page.locator('#invite-url').inputValue()
    expect(url).toContain('/provider/invite/')

    // Close the reveal; the new pending invite now renders in the team list.
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByText(email)).toBeVisible()

    // Persisted through the API to the DB — scoped to the owner's OWN operator,
    // minted as OPERATOR_STAFF + PENDING. Asserting the role (not just existence)
    // proves the client cannot escalate the grant to OPERATOR_OWNER.
    const sql = testSql()
    try {
      const inviteRows = await sql<{ operatorId: string; role: string; status: string }[]>`
        SELECT pi."operatorId", pi.role, pi.status
        FROM provider_invites pi
        WHERE pi.email = ${email}
        LIMIT 1`
      const invite = inviteRows[0]
      expect(invite?.role).toBe('OPERATOR_STAFF')
      expect(invite?.status).toBe('PENDING')

      const ownerRows = await sql<{ operatorId: string }[]>`
        SELECT u."operatorId" FROM users u WHERE u.email = ${OPERATOR_SEED_EMAIL} LIMIT 1`
      expect(invite?.operatorId).toBe(ownerRows[0]?.operatorId)
    } finally {
      await sql.end({ timeout: 5 })
    }
  })
})
