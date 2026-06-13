import {
  CANCELLATION_TIERS,
  type CancellationTier,
  getCancellationTier,
} from '@kuruma/shared/lib/cancellation-policy'
import { useTranslations } from 'use-intl'

interface CancellationPolicyProps {
  /** Pickup time — the tier window is measured from now until this. */
  readonly pickupAt: Date
}

/**
 * Renter-facing tiered cancellation schedule shown BEFORE payment (#657). Renders
 * the canonical schedule from `CANCELLATION_TIERS` (single source of truth) and
 * highlights the tier that applies right now, so the renter sees exactly what
 * cancelling would cost before they commit. Read-only; the authoritative fee is
 * still computed server-side at cancel time.
 */
export function CancellationPolicy({ pickupAt }: CancellationPolicyProps) {
  const t = useTranslations('reservation.cancellation')
  // `now` is read once at render — this is display-only, never a stored value.
  const activeTier = getCancellationTier(pickupAt, new Date())

  return (
    <section className="space-y-2" aria-labelledby="cancellation-policy-heading">
      <h3 id="cancellation-policy-heading" className="text-sm font-semibold">
        {t('heading')}
      </h3>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
        {CANCELLATION_TIERS.map(({ tier }) => {
          const isActive = tier === activeTier
          return (
            <li
              key={tier}
              aria-current={isActive ? 'true' : undefined}
              className={`flex items-center justify-between gap-4 p-3 ${
                isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground'
              }`}
            >
              <span>{tierLabel(t, tier)}</span>
              {isActive ? (
                <span className="shrink-0 text-xs font-medium uppercase tracking-wide">
                  {t('appliesNow')}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// Literal keys (not a template) so the strict use-intl message typing is preserved.
function tierLabel(t: (key: string) => string, tier: CancellationTier): string {
  switch (tier) {
    case 'FREE':
      return t('tiers.FREE')
    case 'LOW':
      return t('tiers.LOW')
    case 'MEDIUM':
      return t('tiers.MEDIUM')
    case 'FULL':
      return t('tiers.FULL')
  }
}
