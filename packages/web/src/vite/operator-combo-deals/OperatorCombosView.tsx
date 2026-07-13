import { Button } from '@/components/ui/button'
import { AddComboDialog } from '@/vite/operator-combo-deals/AddComboDialog'
import type { ComboClassOption, ComboLocationOption } from '@/vite/operator-combo-deals/ComboForm'
import { ComboRow } from '@/vite/operator-combo-deals/ComboRow'
import { EditComboDialog } from '@/vite/operator-combo-deals/EditComboDialog'
import { RemoveComboDialog } from '@/vite/operator-combo-deals/RemoveComboDialog'
import {
  COMBO_QUERY_KEY,
  type ClassRatePlanData,
  updateComboDeal,
} from '@/vite/operator-combo-deals/api'
import { comboErrorMessage } from '@/vite/operator-combo-deals/combo-errors'
import type { OperatorScope } from '@/vite/operator-context'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Tag } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslations } from 'use-intl'

interface OperatorCombosViewProps {
  readonly deals: readonly ClassRatePlanData[]
  /** Operator-scoped classes — resolve a deal's class name + feed the form. */
  readonly classes: readonly ComboClassOption[]
  /** Operator-scoped locations — resolve a deal's location name + feed the form. */
  readonly locations: readonly ComboLocationOption[]
  readonly scope: OperatorScope
}

// Controlled list + empty state. The route owns the loader / useSuspenseQuery for
// the deals, operator-scoped classes, AND locations (FC/IS — shell does I/O, this
// renders). The Add/Edit/Remove dialogs own their write mutations and invalidate
// COMBO_QUERY_KEY on success. The active toggle is a direct PATCH (no dialog) that
// also invalidates the key.
//
// In all-mode (a cross-operator reader with no picked operator) the page is
// read-only: `canWrite` is false so no write affordances render, and
// `showOperator` turns on the per-row operator label.
export function OperatorCombosView({ deals, classes, locations, scope }: OperatorCombosViewProps) {
  const { pickedOperatorId, canWrite, showOperator, operatorNameById } = scope
  const t = useTranslations('business.comboDeals')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<ClassRatePlanData | null>(null)
  const [removing, setRemoving] = useState<ClassRatePlanData | null>(null)

  // The activate direction can 400 (Q-B publishability: the class/location was
  // archived after the deal was created). react-query clears `toggleError` on the
  // next mutate/success, so the banner is self-healing without a manual reset.
  const { mutate: toggle, error: toggleError } = useMutation({
    mutationFn: (deal: ClassRatePlanData) =>
      updateComboDeal(deal.id, { isActive: !deal.isActive }, csrfToken, pickedOperatorId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COMBO_QUERY_KEY }),
  })

  const classNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of classes) map.set(c.id, c.name)
    return map
  }, [classes])

  const locationNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const l of locations) map.set(l.id, l.name)
    return map
  }, [locations])

  const sorted = useMemo(
    () => [...deals].sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '')),
    [deals],
  )

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="flex items-center justify-end">
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="size-4 mr-1.5" />
            {t('addDeal')}
          </Button>
        </div>
      )}

      {toggleError && (
        <p role="alert" className="text-sm text-destructive px-1">
          {comboErrorMessage(toggleError, t)}
        </p>
      )}

      {sorted.length === 0 ? (
        <div className="text-center py-20">
          <Tag className="size-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((deal) => (
            <ComboRow
              key={deal.id}
              deal={deal}
              className={classNameById.get(deal.classId) ?? null}
              locationName={locationNameById.get(deal.pickupLocationId) ?? null}
              canWrite={canWrite}
              operatorName={showOperator ? operatorNameById.get(deal.operatorId) : undefined}
              onEdit={setEditing}
              onToggle={toggle}
              onRemove={setRemoving}
            />
          ))}
        </div>
      )}

      {canWrite ? (
        <>
          <AddComboDialog
            open={showAdd}
            onOpenChange={setShowAdd}
            classes={classes}
            locations={locations}
            pickedOperatorId={pickedOperatorId}
          />
          <EditComboDialog
            deal={editing}
            onOpenChange={() => setEditing(null)}
            classes={classes}
            locations={locations}
            pickedOperatorId={pickedOperatorId}
          />
          <RemoveComboDialog
            deal={removing}
            onOpenChange={() => setRemoving(null)}
            pickedOperatorId={pickedOperatorId}
          />
        </>
      ) : null}
    </div>
  )
}
