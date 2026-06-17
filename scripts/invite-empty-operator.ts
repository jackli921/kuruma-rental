import { getDb } from '../packages/shared/src/db'
import { mintEmptyOperatorInvite } from '../packages/shared/src/db/empty-operator-invite'

// Mint a cold-start operator invite WITHOUT running the full demo seed (#902).
// Unlike `db:seed`, this only upserts the blank "Test Operator" + its one-time
// owner invite, so it is safe to point at the BETA database — it never rewrites
// demo operators/vehicles (which the full seed would, reverting any UI edits).
//
// Usage:
//   DATABASE_URL=<neon-url> WEB_ORIGIN=https://<web-origin> \
//     bun run scripts/invite-empty-operator.ts <email>
// (email may also be supplied via EMPTY_OPERATOR_INVITE_EMAIL.)
const email = process.argv[2]?.trim() || process.env.EMPTY_OPERATOR_INVITE_EMAIL?.trim()
if (!email) {
  console.error(
    'Usage: bun run scripts/invite-empty-operator.ts <email>  (or set EMPTY_OPERATOR_INVITE_EMAIL)',
  )
  process.exit(1)
}

const webOrigin = process.env.WEB_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:3001'

mintEmptyOperatorInvite(getDb(), { email, webOrigin })
  .then(({ inviteUrl, operatorSlug }) => {
    console.log(`\nEmpty operator invite for ${email.toLowerCase()} (operator: ${operatorSlug}):`)
    console.log(`  ${inviteUrl}\n`)
    process.exit(0)
  })
  .catch((err) => {
    console.error('Invite mint failed:', err)
    process.exit(1)
  })
