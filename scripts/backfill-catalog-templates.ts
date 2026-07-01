import { runTx } from '../packages/shared/src/db'
import { backfillCatalogTemplates } from '../packages/shared/src/db/backfill-catalog-templates'

// CLI entry for `bun run db:backfill-catalog-templates` — the one-off slice-2a
// backfill that gives every null-templateId add_on_options row a template
// (map onto a curated template, mint an ARCHIVED one for an orphan name, or
// merge intra-operator duplicates) against the Neon DATABASE_URL.
//
// Wrapped in `runTx` (NOT `getDb()`): the map-or-mint-or-merge must be atomic
// (the archive-before-stamp ordering the partial unique requires), and the
// neon-http `getDb()` handle throws on `db.transaction`. Run once against prod,
// then gate PR2 (slice 5) on `db:audit-catalog-templates` reporting clean.
runTx((tx) => backfillCatalogTemplates(tx))
  .then((report) => {
    console.log(
      `Catalog backfill complete: ${report.mapped} row(s) mapped, ` +
        `${report.minted} template(s) minted, ${report.mergedDuplicates} duplicate(s) merged.`,
    )
    process.exit(0)
  })
  .catch((err) => {
    console.error('Catalog backfill failed:', err)
    process.exit(1)
  })
