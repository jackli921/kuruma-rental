import { Badge } from '@/components/ui/badge'
import type { ClassSummaryData } from '@/vite/storefronts/api'
import { useTranslations } from 'use-intl'

interface ClassSummaryBadgesProps {
  readonly summaries: ClassSummaryData[]
}

/**
 * Renders the per-class availability chips on a storefront card ("Compact ×4").
 * The label is the localized ACRISS name when a code is mapped, falling back to
 * the operator-entered class name (#388, acrissCode is nullable). One neutral
 * badge style for all classes — counts are not a status, so no ad-hoc colors.
 */
export function ClassSummaryBadges({ summaries }: ClassSummaryBadgesProps) {
  const t = useTranslations('search')
  const tAcriss = useTranslations('acriss')

  return (
    <div className="flex flex-wrap gap-1.5">
      {summaries.map((summary) => {
        const label =
          summary.acrissCode && tAcriss.has(summary.acrissCode)
            ? tAcriss(summary.acrissCode)
            : summary.label
        return (
          <Badge key={`${summary.acrissCode ?? 'na'}-${summary.label}`} variant="secondary">
            {t('classCount', { label, count: summary.availableCount })}
          </Badge>
        )
      })}
    </div>
  )
}
