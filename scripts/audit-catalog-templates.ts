import { getDb } from '../packages/shared/src/db'
import { auditCatalogTemplates } from '../packages/shared/src/db/backfill-catalog-templates'

// CLI entry for `bun run db:audit-catalog-templates` — a read-only cross-check that
// no operator holds two ACTIVE add-on rows on one template. Read-only, so it uses the
// neon-http `getDb()` handle (no transaction). The former null-templateId gate was
// removed (#1437): a self-authored add-on is legitimately null-templateId, so the
// slice-5 NOT-NULL flip is cancelled. Exits non-zero and NAMES the offending rows.
auditCatalogTemplates(getDb())
  .then((report) => {
    const { duplicateActiveTemplateGroups } = report
    if (duplicateActiveTemplateGroups.length === 0) {
      console.log('Catalog audit clean: no operator holds a duplicate ACTIVE template.')
      process.exit(0)
    }

    console.error('Catalog audit FAILED:')
    for (const group of duplicateActiveTemplateGroups) {
      console.error(
        `  operator ${group.operatorId} holds ${group.rowIds.length} ACTIVE rows on template ${group.templateId}:`,
        group.rowIds,
      )
    }
    process.exit(1)
  })
  .catch((err) => {
    console.error('Catalog audit errored:', err)
    process.exit(1)
  })
