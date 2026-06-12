import { Button } from '@/components/ui/button'
import { ClassStatusBadge } from '@/vite/operator-classes/ClassStatusBadge'
import type { OperatorClass } from '@/vite/operator-classes/api'
import { Layers, Pencil, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslations } from 'use-intl'

interface OperatorClassesViewProps {
  readonly classes: readonly OperatorClass[]
  /** Opens the edit dialog for a class. Omitted -> no edit affordance: read-only
   * for bypass roles (#583), and in isolation tests. `| undefined` is explicit so
   * the route can pass `canWrite ? setX : undefined` under exactOptionalPropertyTypes. */
  readonly onEdit?: ((vehicleClass: OperatorClass) => void) | undefined
  /** Opens the archive (delete) dialog for a class. Disabled on already-archived
   * rows. Omitted -> no delete affordance (read-only / isolation tests). */
  readonly onDelete?: ((vehicleClass: OperatorClass) => void) | undefined
}

// Presentational list + empty state (FC/IS): a pure function of the resolved
// classes, so it stays unit-testable. The route owns the loader / useSuspenseQuery
// and the pending/error boundaries, and holds the edit/delete dialog state.
//
// Per-class stats (cars / active bookings) are intentionally omitted: the Vite
// fleet-overview isn't ported yet (#526), so rather than block on it we surface
// the class's own seats/luggage and degrade the fleet-derived counts.
export function OperatorClassesView({ classes, onEdit, onDelete }: OperatorClassesViewProps) {
  const t = useTranslations('business.classes')
  const tAcriss = useTranslations('acriss')

  const sorted = useMemo(
    () =>
      [...classes].sort((a, b) =>
        a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.name.localeCompare(b.name),
      ),
    [classes],
  )

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border py-20">
        <Layers className="mb-4 size-12 text-muted-foreground/30" />
        <p className="text-lg text-muted-foreground">{t('empty')}</p>
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {sorted.map((c) => {
        // Friendly ACRISS label with raw-code fallback: a code outside the
        // 8-key dictionary (operators may enter their own) renders the code
        // itself, never a missing-key crash (#388).
        const acrissLabel = c.acrissCode
          ? tAcriss.has(c.acrissCode)
            ? tAcriss(c.acrissCode)
            : c.acrissCode
          : null
        return (
          <li
            key={c.id}
            className="flex items-start gap-4 rounded-lg border border-border p-4 transition-colors hover:bg-accent/30"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-lg font-medium">{c.name}</h3>
                <ClassStatusBadge status={c.status} />
                {acrissLabel && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {acrissLabel}
                  </span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">{c.slug}</p>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                <span>{t('stats.seats', { count: c.seats })}</span>
                <span>{t('stats.luggage', { count: c.luggageCapacity })}</span>
              </div>
            </div>

            {(onEdit || onDelete) && (
              <div className="flex shrink-0 items-center gap-1">
                {onEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEdit(c)}
                    aria-label={t('editClass')}
                  >
                    <Pencil className="size-4" />
                  </Button>
                )}
                {onDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(c)}
                    aria-label={t('deleteAction')}
                    // An archived class is already soft-deleted; nothing to do.
                    disabled={c.status === 'ARCHIVED'}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
