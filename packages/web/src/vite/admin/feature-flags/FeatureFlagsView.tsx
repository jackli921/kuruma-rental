import { Switch } from '@/components/ui/switch'
import type { FeatureFlagKey } from '@kuruma/shared/feature-flags/registry'
import { useTranslations } from 'use-intl'

export interface FeatureFlagRow {
  readonly key: FeatureFlagKey
  readonly label: string
  /** effective = server override ?? build-time default. What the switch shows. */
  readonly effective: boolean
  /** True when a DB override is set (vs. following the build-time default). */
  readonly overridden: boolean
  /** True once a consumer reads the flag via useFeatureFlag(), so its toggle takes
   *  effect live; false = build-time only (the toggle persists but is inert until
   *  that flag's runtime migration ships). Surfaced so a no-op toggle is honest. */
  readonly runtimeControlled: boolean
}

interface FeatureFlagsViewProps {
  readonly rows: readonly FeatureFlagRow[]
  /** The flag whose toggle is in flight, so only its switch disables. */
  readonly pendingKey: FeatureFlagKey | null
  readonly onToggle: (key: FeatureFlagKey, enabled: boolean) => void
}

/**
 * Platform-admin runtime feature-flag switchboard. Pure function of props (FC/IS —
 * the route owns the query + mutation). One row per registry flag showing its
 * human label, whether it is overridden or following the build default, and an
 * ON/OFF switch that writes the override live (owner picked ON/OFF-only, no reset).
 */
export function FeatureFlagsView({ rows, pendingKey, onToggle }: FeatureFlagsViewProps) {
  const t = useTranslations('admin.featureFlags')
  const head = 'px-3 py-2 text-left font-medium text-muted-foreground'

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="font-semibold text-2xl">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-border border-b bg-muted/50">
            <tr>
              <th scope="col" className={head}>
                {t('colFeature')}
              </th>
              <th scope="col" className={head}>
                {t('colSource')}
              </th>
              <th scope="col" className={`${head} text-right`}>
                {t('colState')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-border border-b last:border-0">
                <td className="px-3 py-3">
                  <div>
                    <span className="font-medium">{row.label}</span>
                    <span className="ml-2 text-muted-foreground text-xs">{row.key}</span>
                  </div>
                  <span
                    className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs ${
                      row.runtimeControlled
                        ? 'bg-emerald-500/10 text-emerald-600'
                        : 'bg-amber-500/10 text-amber-600'
                    }`}
                    title={row.runtimeControlled ? undefined : t('buildOnlyHint')}
                  >
                    {row.runtimeControlled ? t('runtimeLive') : t('runtimeBuildOnly')}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                      row.overridden
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {row.overridden ? t('overridden') : t('default')}
                  </span>
                </td>
                <td className="px-3 py-3 text-right">
                  <Switch
                    checked={row.effective}
                    disabled={pendingKey === row.key}
                    onCheckedChange={(checked) => onToggle(row.key, checked)}
                    aria-label={t('toggleLabel', { feature: row.label })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
