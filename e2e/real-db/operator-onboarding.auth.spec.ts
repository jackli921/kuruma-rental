import { expect, test } from '@playwright/test'
import {
  SESSION_COOKIE_NAME,
  mintAdminSessionToken,
  mintRenterSessionTokenFor,
} from './mint-session'
import { testSql } from './pg'

// Sign-in-first operator onboarding (#877, §6.2): the invite-link flow is GONE.
// A signed-in RENTER applies from /business/register; a platform admin approves;
// approval promotes THAT SAME account directly to OPERATOR_OWNER (membership +
// users projection, NO invite minted); on the applicant's next GET /auth/session
// (triggered by the /operator/welcome route) the stale RENTER session reconciles
// and re-mints to OWNER, landing on the operator portal with no re-login.
//
// This drives the real Vite UI -> Hono API -> Postgres stack across all three
// personas in one journey. There are NO /provider/invite/ assertions — that flow
// no longer exists.
//
// Fixture: a throwaway RENTER applicant inserted directly over pg (NOT the seeded
// Sarah Smith — approving her would corrupt every other renter spec). Its ORIGINAL
// stale RENTER token is captured once and re-presented after promotion. Torn down
// FK-safe in afterAll (memberships -> applications -> users -> operators), scoped by
// the synthetic email/name suffix, plus a self-heal sweep of stale (> 1 hour) rows.

const SUFFIX = Date.now()
// operators.id / users.id / operator_memberships.id default via a drizzle $defaultFn
// (app-level), which does NOT fire on a raw pg INSERT — so the applicant id is set
// explicitly here (the app never sees this row until approval reads it).
const applicantUserId = crypto.randomUUID()
const applicantEmail = `e2e-applicant-${SUFFIX}@example.test`
const applicantName = `E2E Applicant ${SUFFIX}`
const businessName = `E2E Onboarding Co ${SUFFIX}`

const ONE_HOUR_S = 60 * 60
const NAME_PREFIX = 'E2E Onboarding Co '
const EMAIL_PREFIX = 'e2e-applicant-'

// Captured ONCE from the fresh applicant row and re-used verbatim in step 6 — the
// whole point is that a STALE renter session (minted BEFORE promotion) reconciles.
let applicantRenterToken: string

test.describe('sign-in-first operator onboarding — apply -> approve -> auto-promote (real DB)', () => {
  test.beforeAll(async () => {
    const sql = testSql()
    try {
      // Self-heal zombies from a prior run hard-killed before afterAll (CI OOM /
      // timeout). Scope to rows older than an hour so this run's own (seconds old,
      // workers:1 serial) are never touched. FK-restrict order: memberships +
      // applications reference user + operator; and a PROMOTED applicant's
      // users.operatorId points AT its operator, so users must go BEFORE operators.
      await sql`
        DELETE FROM operator_memberships WHERE "userId" IN (
          SELECT id FROM users
          WHERE email LIKE ${`${EMAIL_PREFIX}%`} AND "createdAt" < now() - interval '1 hour')`
      await sql`
        DELETE FROM operator_applications WHERE "applicantUserId" IN (
          SELECT id FROM users
          WHERE email LIKE ${`${EMAIL_PREFIX}%`} AND "createdAt" < now() - interval '1 hour')`
      await sql`
        DELETE FROM users WHERE email LIKE ${`${EMAIL_PREFIX}%`}
          AND "createdAt" < now() - interval '1 hour'`
      await sql`
        DELETE FROM operators WHERE name LIKE ${`${NAME_PREFIX}%`}
          AND "createdAt" < now() - interval '1 hour'`

      // The throwaway applicant: a plain RENTER with no operator. operatorId is null,
      // so mintRenterSessionTokenFor omits the tenant claim (a real renter's shape).
      await sql`
        INSERT INTO users (id, email, role, "operatorId", name)
        VALUES (${applicantUserId}, ${applicantEmail}, 'RENTER', NULL, ${applicantName})`
    } finally {
      await sql.end({ timeout: 5 })
    }

    // Mint the stale RENTER token AFTER the row exists (mintSession resolves the id
    // by email). Store it — step 6 re-presents this exact string post-promotion.
    applicantRenterToken = await mintRenterSessionTokenFor(applicantEmail, applicantName)
  })

  test.afterAll(async () => {
    const sql = testSql()
    try {
      // FK-safe teardown, scoped to THIS run's synthetic ids. After promotion the
      // applicant IS the operator's OWNER, so users.operatorId points AT the operator
      // (users_operatorId_operators_id_fk) — the user must go BEFORE the operator, or
      // the operator delete violates that FK. Order: operator_memberships +
      // operator_applications (both reference user + operator) -> users -> operators.
      await sql`DELETE FROM operator_memberships WHERE "userId" = ${applicantUserId}`
      await sql`DELETE FROM operator_applications WHERE "applicantUserId" = ${applicantUserId}`
      await sql`DELETE FROM users WHERE id = ${applicantUserId}`
      await sql`DELETE FROM operators WHERE name = ${businessName}`
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  // Replace the session cookie for the active context with a fresh token. Same
  // name/domain/path overwrites the previous persona, so the next navigation loads
  // as whoever `token` identifies.
  async function setSessionCookie(
    context: import('@playwright/test').BrowserContext,
    token: string,
  ): Promise<void> {
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        expires: Math.floor(Date.now() / 1000) + ONE_HOUR_S,
      },
    ])
  }

  test('a renter applies, an admin approves, and the stale renter session auto-promotes to the operator portal', async ({
    context,
    page,
  }) => {
    // Vite lazily compiles the /business/register, /admin/operator-applications and
    // /operator/welcome routes on first hit across three personas in one test.
    test.setTimeout(180_000)

    await test.step('applicant submits the sign-in-first registration form', async () => {
      await setSessionCookie(context, applicantRenterToken)
      await page.goto('/en/business/register')
      await expect(page).toHaveURL(/\/en\/business\/register\/?$/, { timeout: 30_000 })

      // The email field is locked (read-only, server-derived) — assert it shows the
      // applicant's account email and is not editable, but never type into it.
      const emailField = page.locator('#reg-accountEmail')
      await expect(emailField).toHaveValue(applicantEmail)
      await expect(emailField).toHaveAttribute('readonly', '')

      await page.locator('#reg-businessName').fill(businessName)
      await page.locator('#reg-contactName').fill('Onboarding Owner')
      await page.locator('#reg-contactPhone').fill('+81 90-1234-5678')
      await page.locator('#reg-serviceArea').fill('Osaka')
      await page.locator('#reg-fleetSize').selectOption('6-20')
      // Consent is a literal(true) gate — must be checked or the submit 400s.
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Submit application' }).click()

      // The pending/success surface (RegistrationSuccess) confirms the POST landed.
      await expect(page.getByText('Application received')).toBeVisible()
    })

    await test.step('DB: exactly one PENDING application for this applicant', async () => {
      const sql = testSql()
      try {
        const rows = await sql<{ status: string; applicantUserId: string | null }[]>`
          SELECT status, "applicantUserId" FROM operator_applications
          WHERE "applicantUserId" = ${applicantUserId}`
        expect(rows).toHaveLength(1)
        expect(rows[0]?.status).toBe('PENDING')
        expect(rows[0]?.applicantUserId).toBe(applicantUserId)
      } finally {
        await sql.end({ timeout: 5 })
      }
    })

    await test.step('platform admin approves the application (no invite link surfaces)', async () => {
      await setSessionCookie(context, await mintAdminSessionToken())
      await page.goto('/en/admin/operator-applications')

      const card = page.locator('article').filter({ hasText: businessName })
      await expect(card).toBeVisible({ timeout: 30_000 })

      await card.getByRole('button', { name: 'Approve' }).click()

      // Terminal state: the card shows the plain "Approved" confirmation in a
      // role=status live region (the <output> in ApplicationReviewCard), and the
      // Approve/Reject controls are gone. Direct promotion mints NO invite, so there
      // is no invite-link input / copy / regenerate control to find.
      await expect(card.getByText('Approved', { exact: true })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Approve' })).toHaveCount(0)
      await expect(card.getByRole('button', { name: /invite|copy|regenerate/i })).toHaveCount(0)
      await expect(card.locator('input[readonly]')).toHaveCount(0)
    })

    await test.step('DB: direct promotion — APPROVED app, ACTIVE OWNER membership, projected users row, NO invite', async () => {
      const sql = testSql()
      try {
        const [app] = await sql<{ status: string; operatorId: string | null }[]>`
          SELECT status, "operatorId" FROM operator_applications
          WHERE "applicantUserId" = ${applicantUserId}`
        expect(app?.status).toBe('APPROVED')
        expect(app?.operatorId).not.toBeNull()
        const operatorId = app?.operatorId as string

        const memberships = await sql<{ role: string; status: string; operatorId: string }[]>`
          SELECT role, status, "operatorId" FROM operator_memberships
          WHERE "userId" = ${applicantUserId}`
        expect(memberships).toHaveLength(1)
        expect(memberships[0]).toMatchObject({
          role: 'OPERATOR_OWNER',
          status: 'ACTIVE',
          operatorId,
        })

        // The users projection (what the JWT reconcile reads) now points at the
        // operator — this is the write step 6 depends on.
        const [projected] = await sql<{ role: string; operatorId: string | null }[]>`
          SELECT role, "operatorId" FROM users WHERE id = ${applicantUserId}`
        expect(projected?.role).toBe('OPERATOR_OWNER')
        expect(projected?.operatorId).toBe(operatorId)

        // Direct promotion issues NO provider invite for this operator/applicant.
        const invites = await sql<{ id: string }[]>`
          SELECT id FROM provider_invites
          WHERE "operatorId" = ${operatorId} OR email = ${applicantEmail}`
        expect(invites).toHaveLength(0)
      } finally {
        await sql.end({ timeout: 5 })
      }
    })

    await test.step('the STALE renter session reconciles and lands on the operator portal — no re-login', async () => {
      // Re-present the EXACT token minted in beforeAll (before promotion). The welcome
      // route invalidates ['session'] and refetches GET /auth/session, which reads the
      // now-OWNER users projection and re-mints with operatorSlug -> redirect to
      // /dashboard. If reconcile did not run, we'd stall on the pending holding page
      // (or bounce to /login) — never the dashboard.
      await setSessionCookie(context, applicantRenterToken)
      await page.goto('/en/operator/welcome')

      await expect(page).toHaveURL(/\/en\/dashboard\/?$/, { timeout: 30_000 })
      // The operator dashboard surface rendered — not a sign-in redirect.
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(page).not.toHaveURL(/\/(sign-in|login)/)
    })
  })
})
