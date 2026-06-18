import { expect, test } from '@playwright/test'
import { SESSION_COOKIE_NAME, mintOperatorSessionTokenFor } from './mint-session'
import { testSql } from './pg'

// #953: cold-start empty-state coverage. Every OTHER operator spec runs against
// the SEEDED Best Car Rental (full fleet / team / settings). This one stands up a
// brand-new operator with ZERO operator-owned data and a fresh OPERATOR_OWNER,
// then asserts the self-serve surfaces render and configure correctly FROM EMPTY
// — the one DoD clause epic #902 deferred here. Slice 1 covers settings (#903)
// and team (#904); fleet/classes/locations (S2) and insurance/fees/add-ons (S3)
// follow in separate specs.
//
// Self-contained: the fixture is created in beforeAll and torn down in afterAll
// (FK-safe order: invites -> users -> operator), so it never pollutes the shared
// seed the other specs depend on (workers: 1, so teardown lands before the next
// file). It deliberately inserts NO operator_memberships row — the demo seed
// creates none for its owners either (seed.ts only writes the users projection),
// so an empty members list is the realistic cold-start, not an artifact.
const SUFFIX = Date.now()
// `operators.id` / `users.id` default via a drizzle $defaultFn (app-level), NOT a
// DB DEFAULT, so a raw INSERT must supply both ids itself or hit a NOT NULL.
const operatorId = crypto.randomUUID()
const ownerUserId = crypto.randomUUID()
const ownerEmail = `e2e-cold-owner-${SUFFIX}@example.test`
const operatorName = `E2E Cold Operator ${SUFFIX}`
const slug = `e2e-cold-${SUFFIX}`

const ONE_HOUR_S = 60 * 60

test.describe('operator cold-start empty-state (authenticated, real DB)', () => {
  test.beforeAll(async () => {
    const sql = testSql()
    try {
      // Self-heal stale fixtures from a prior run that was hard-KILLED before its
      // afterAll could run (CI timeout / OOM — Playwright runs afterAll on normal
      // throws + failures, so only a process death skips it). The seed upserts
      // only KNOWN operators, never strays, so an orphaned cold-start operator
      // would otherwise accrete on the shared e2e branch forever. Scope to rows
      // older than an hour: never this run's own (the lane is workers:1 / serial,
      // so they're seconds old), only genuine zombies. FK-restrict order — the
      // operator's children (invites, the owner user) go before the operator.
      await sql`
        DELETE FROM provider_invites WHERE "operatorId" IN (
          SELECT id FROM operators
          WHERE slug LIKE 'e2e-cold-%' AND "createdAt" < now() - interval '1 hour')`
      await sql`
        DELETE FROM users WHERE "operatorId" IN (
          SELECT id FROM operators
          WHERE slug LIKE 'e2e-cold-%' AND "createdAt" < now() - interval '1 hour')`
      await sql`
        DELETE FROM operators
        WHERE slug LIKE 'e2e-cold-%' AND "createdAt" < now() - interval '1 hour'`

      await sql`
        INSERT INTO operators (id, slug, name)
        VALUES (${operatorId}, ${slug}, ${operatorName})`
      await sql`
        INSERT INTO users (id, email, role, "operatorId", name)
        VALUES (${ownerUserId}, ${ownerEmail}, 'OPERATOR_OWNER', ${operatorId}, 'Cold Start Owner')`
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  test.afterAll(async () => {
    const sql = testSql()
    try {
      // provider_invites + users both reference operators with ON DELETE RESTRICT,
      // so they must be cleared before the operator. (An invite's invitedByUserId
      // is ON DELETE SET NULL, so its order vs users is free; invites first keeps
      // it simple.)
      await sql`DELETE FROM provider_invites WHERE "operatorId" = ${operatorId}`
      await sql`DELETE FROM users WHERE "operatorId" = ${operatorId}`
      await sql`DELETE FROM operators WHERE id = ${operatorId}`
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  // Swap the project storageState (Best Car Rental owner) onto the cold operator
  // before each navigation. Same cookie name/domain/path replaces the seeded one,
  // so the page loads as THIS operator — not the seeded tenant with all its data.
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: await mintOperatorSessionTokenFor(ownerEmail),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        expires: Math.floor(Date.now() / 1000) + ONE_HOUR_S,
      },
    ])
  })

  test('settings render for a fresh operator and a first handoff-URL save round-trips (P1)', async ({
    page,
  }) => {
    await page.goto('/en/manage/settings')
    // The cold operator's session is honoured — no redirect to sign-in.
    await expect(page).toHaveURL(/\/en\/manage\/settings\/?$/)

    // Prefilled with the new operator's OWN name (proves the page is scoped to it,
    // not the seeded tenant). The handoff URL was never set, so the field is empty
    // and still editable for the owner — the empty state must not crash or disable.
    await expect(page.locator('#settings-name')).toHaveValue(operatorName)
    const handoff = page.locator('#settings-handoff')
    await expect(handoff).toHaveValue('')
    await expect(handoff).toBeEnabled()

    const newUrl = `https://pay.e2e.example/cold-${SUFFIX}`
    await handoff.fill(newUrl)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Settings saved.')).toBeVisible()

    // Persisted through the API to the DB — configuring from zero actually writes.
    const sql = testSql()
    try {
      const rows = await sql<{ preAuthHandoffUrl: string | null }[]>`
        SELECT pre_auth_handoff_url AS "preAuthHandoffUrl"
        FROM operators WHERE id = ${operatorId} LIMIT 1`
      expect(rows[0]?.preAuthHandoffUrl).toBe(newUrl)
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  test('team shows empty members + invites, and a first invite persists scoped to this operator (P1)', async ({
    page,
  }) => {
    await page.goto('/en/manage/team')
    // The cold operator's session is honoured — no redirect to sign-in.
    await expect(page).toHaveURL(/\/en\/manage\/team\/?$/)

    // Cold start: no membership rows and no pending invites -> both empty states
    // render (not a spinner, error, or crash).
    await expect(page.getByText('No members yet.')).toBeVisible()
    await expect(page.getByText('No pending invites.')).toBeVisible()

    // Inviting works from zero; the new pending row then appears in the list,
    // proving the empty team is a starting point and not a dead end.
    const inviteEmail = `e2e-cold-staff-${SUFFIX}@example.test`
    await page.getByRole('button', { name: 'Invite staff' }).click()
    await page.locator('#invite-email').fill(inviteEmail)
    await page.getByRole('button', { name: 'Send invite' }).click()

    await expect(page.getByText('Invite created')).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByText(inviteEmail)).toBeVisible()

    // Persisted through the API, scoped to THIS operator and minted OPERATOR_STAFF
    // + PENDING — the client cannot escalate the grant or cross tenants.
    const sql = testSql()
    try {
      const rows = await sql<{ operatorId: string; role: string; status: string }[]>`
        SELECT "operatorId", role, status FROM provider_invites
        WHERE email = ${inviteEmail} LIMIT 1`
      const invite = rows[0]
      expect(invite?.operatorId).toBe(operatorId)
      expect(invite?.role).toBe('OPERATOR_STAFF')
      expect(invite?.status).toBe('PENDING')
    } finally {
      await sql.end({ timeout: 5 })
    }
  })
})
