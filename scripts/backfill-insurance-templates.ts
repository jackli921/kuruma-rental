import { runTx } from '../packages/shared/src/db'
import { backfillInsuranceTemplates } from '../packages/shared/src/db/backfill-insurance-templates'

// CLI entry for `bun run db:backfill-insurance-templates` — the one-off slice-3a
// backfill that gives every null-templateId insurance_options row a template
// (map onto a curated template, mint an ARCHIVED one for an orphan name, or
// merge intra-operator duplicates) against the Neon DATABASE_URL.
//
// Wrapped in `runTx` (NOT `getDb()`): the map-or-mint-or-merge must be atomic
// (the archive-before-stamp ordering the partial unique requires), and the
// neon-http `getDb()` handle throws on `db.transaction`. Run once against prod,
// then gate PR2 (slice 5) on `db:audit-insurance-templates` reporting clean.
runTx((tx) => backfillInsuranceTemplates(tx))
  .then((report) => {
    console.log(
      `Insurance backfill complete: ${report.mapped} row(s) mapped, ` +
        `${report.minted} template(s) minted, ${report.mergedDuplicates} duplicate(s) merged.`,
    )
    process.exit(0)
  })
  .catch((err) => {
    console.error('Insurance backfill failed:', err)
    process.exit(1)
  })
