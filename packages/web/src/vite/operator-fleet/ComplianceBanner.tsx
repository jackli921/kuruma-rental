import { filterVehicles } from '@/lib/fleet-filters'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import { Link } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface ComplianceBannerProps {
  readonly vehicles: readonly OperatorFleetVehicle[]
  readonly locale: string
}

// §5.5 in-app compliance banner (#916). Rendered on the operator dashboard,
// surfaces how many fleet vehicles have shaken/insurance expired or expiring soon
// and deep-links to the fleet pre-filtered to that same set. The count comes from
// the shared `filterVehicles({ expiringSoon })` the fleet view uses, so the
// headline number can never drift from the list the link lands on (FC/IS — pure
// derivation, no I/O). Renders nothing when the fleet is fully compliant.
export function ComplianceBanner({ vehicles, locale }: ComplianceBannerProps) {
  const t = useTranslations('business.dashboard.compliance')
  const count = filterVehicles([...vehicles], { expiringSoon: true }).length
  if (count === 0) return null

  return (
    // A persistent advisory rendered on dashboard load — role="status" (polite),
    // not role="alert" (assertive), so screen readers don't interrupt every visit.
    // biome-ignore lint/a11y/useSemanticElements: <output> is phrasing-only and can't host this banner's heading + body + action-link flow content; role="status" on the container is the correct polite live region.
    <div
      role="status"
      className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">{t('heading', { count })}</p>
        <p className="text-sm text-amber-800 dark:text-amber-300/90">{t('body')}</p>
      </div>
      <Link
        to="/$locale/manage/fleet"
        params={{ locale }}
        search={{ expiringSoon: true }}
        className="ml-auto inline-flex items-center rounded-lg border border-amber-400 px-3 py-1.5 text-sm font-medium hover:bg-amber-100 dark:hover:bg-amber-500/20"
      >
        {t('action')}
      </Link>
    </div>
  )
}
