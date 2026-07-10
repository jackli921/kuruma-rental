import { DrizzleConsentRepository } from '../packages/api/src/repositories/drizzle/consent'
import { ConsentEvidenceService } from '../packages/api/src/services/consent-evidence'
import { resolveSigningKey } from '../packages/api/src/services/consent-signing'
// Usage: bun run consent:evidence -- <acceptanceId> | --user <id> | --booking <id>
import { getDb, runTx } from '../packages/shared/src/db'

async function main() {
  const [a, b] = process.argv.slice(2)
  const repo = new DrizzleConsentRepository(getDb(), runTx)
  const svc = new ConsentEvidenceService(repo, (keyId) => {
    const k = resolveSigningKey()
    return k && k.keyId === keyId ? k : undefined
  })
  const out =
    a === '--user'
      ? await svc.getConsentEvidenceForUser(b)
      : a === '--booking'
        ? await svc.getConsentEvidenceForBooking(b)
        : await svc.getConsentEvidence(a)
  if (!out) {
    console.error('not found')
    process.exit(1)
  }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
