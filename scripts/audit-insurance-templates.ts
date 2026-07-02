import { getDb } from '../packages/shared/src/db'
import { auditInsuranceTemplates } from '../packages/shared/src/db/backfill-insurance-templates'

// CLI entry for `bun run db:audit-insurance-templates` — the read-only pre-PR2
// gate the owner runs against PROD before flipping `insurance_options.templateId`
// NOT NULL (slice 5). Read-only, so it uses the neon-http `getDb()` handle (no
// transaction). Exits non-zero and NAMES the offending rows when either check
// fails, so the gate points at what to fix rather than a bare count.
auditInsuranceTemplates(getDb())
  .then((report) => {
    const { nullTemplateIdRowIds, duplicateActiveTemplateGroups } = report
    if (nullTemplateIdRowIds.length === 0 && duplicateActiveTemplateGroups.length === 0) {
      console.log(
        'Insurance audit clean: every insurance row is templated; no operator holds a duplicate.',
      )
      process.exit(0)
    }

    console.error('Insurance audit FAILED — do not flip templateId NOT NULL:')
    if (nullTemplateIdRowIds.length > 0) {
      console.error(
        `  ${nullTemplateIdRowIds.length} row(s) with null templateId:`,
        nullTemplateIdRowIds,
      )
    }
    for (const group of duplicateActiveTemplateGroups) {
      console.error(
        `  operator ${group.operatorId} holds ${group.rowIds.length} ACTIVE rows on template ${group.templateId}:`,
        group.rowIds,
      )
    }
    process.exit(1)
  })
  .catch((err) => {
    console.error('Insurance audit errored:', err)
    process.exit(1)
  })
