import { Badge } from '@/components/ui/badge'
import { Briefcase } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ClassSummaryData } from '../api'

interface ClassSummaryBadgesProps {
  summaries: ClassSummaryData[]
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
  const tSize = useTranslations('luggageSize')

  return (
    <div className="flex flex-wrap gap-1.5">
      {summaries.map((summary) => {
        const label =
          summary.acrissCode && tAcriss.has(summary.acrissCode)
            ? tAcriss(summary.acrissCode)
            : summary.label
        // #457 D6: surface the class default luggage so renters can compare
        // storefronts at a glance. The chip stays compact (briefcase + bag
        // count); the full "{n} bags · {size}" rides along in the title.
        const bags = summary.luggageCapacity
        const luggageTitle =
          bags == null
            ? undefined
            : summary.luggageSize != null
              ? `${t('luggage', { count: bags })} · ${tSize(summary.luggageSize)}`
              : t('luggage', { count: bags })
        return (
          <Badge
            key={`${summary.acrissCode ?? 'na'}-${summary.label}`}
            variant="secondary"
            className="gap-1.5"
          >
            {t('classCount', { label, count: summary.availableCount })}
            {bags != null && (
              <span
                className="inline-flex items-center gap-0.5 text-muted-foreground"
                title={luggageTitle}
              >
                <Briefcase className="size-3" aria-hidden />
                {bags}
              </span>
            )}
          </Badge>
        )
      })}
    </div>
  )
}
