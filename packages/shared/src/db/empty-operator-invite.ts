import { createHash, randomBytes } from 'node:crypto'
import type { getDb } from './index'
import { operators, providerInvites } from './schema'
import { seedId } from './seed-id'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const EMPTY_OPERATOR_ID = 'op_test_operator'
const EMPTY_OPERATOR_SLUG = 'test-operator'
const EMPTY_OPERATOR_NAME = 'Test Operator'

/**
 * Upsert a blank operator (no vehicles/classes/locations/insurance/add-ons/fees)
 * and mint a one-time OPERATOR_OWNER provider invite for `email`, so a business
 * owner can sign into a cold-start portal and configure everything by hand to
 * verify the operator setup UI (#902).
 *
 * Stable ids keep re-runs idempotent: the token rotates and the invite resets to
 * PENDING so the link is replayable even after acceptance. Only sha256(token) is
 * stored — the caller is handed the plaintext URL once and must not log it
 * server-side. Used by the local seed (env-gated) and by the standalone
 * scripts/invite-empty-operator.ts, which can safely target the beta DB because
 * it ONLY touches this operator + invite and never the demo data.
 */
export async function mintEmptyOperatorInvite(
  db: ReturnType<typeof getDb>,
  opts: { email: string; webOrigin: string; now?: Date },
): Promise<{ inviteUrl: string; operatorSlug: string }> {
  const email = opts.email.trim().toLowerCase()
  const now = opts.now ?? new Date()
  const webBase = opts.webOrigin.replace(/\/$/, '')

  await db
    .insert(operators)
    .values({
      id: seedId(EMPTY_OPERATOR_ID),
      slug: EMPTY_OPERATOR_SLUG,
      name: EMPTY_OPERATOR_NAME,
      preAuthHandoffUrl: null,
    })
    .onConflictDoUpdate({
      target: operators.id,
      set: { slug: EMPTY_OPERATOR_SLUG, name: EMPTY_OPERATOR_NAME, updatedAt: now },
    })

  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS)
  await db
    .insert(providerInvites)
    .values({
      id: seedId('empty-operator-invite'),
      email,
      operatorId: seedId(EMPTY_OPERATOR_ID),
      role: 'OPERATOR_OWNER',
      tokenHash,
      status: 'PENDING',
      expiresAt,
      acceptedByUserId: null,
    })
    .onConflictDoUpdate({
      target: providerInvites.id,
      set: {
        email,
        operatorId: seedId(EMPTY_OPERATOR_ID),
        tokenHash,
        status: 'PENDING',
        expiresAt,
        acceptedByUserId: null,
        updatedAt: now,
      },
    })

  return { inviteUrl: `${webBase}/provider/invite/${token}`, operatorSlug: EMPTY_OPERATOR_SLUG }
}
