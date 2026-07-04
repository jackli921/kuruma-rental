import { Button } from '@/components/ui/button'
import type { OperatorScope } from '@/vite/operator-context'
import { AddFeeDialog } from '@/vite/operator-fees/AddFeeDialog'
import { ArchiveFeeDialog } from '@/vite/operator-fees/ArchiveFeeDialog'
import { EditFeeDialog } from '@/vite/operator-fees/EditFeeDialog'
import { FeeRow } from '@/vite/operator-fees/FeeRow'
import type { FeeClassOption } from '@/vite/operator-fees/FeeScheduleForm'
import type { FeeScheduleData } from '@/vite/operator-fees/api'
import { Plus, Receipt } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslations } from 'use-intl'

interface OperatorFeesViewProps {
  readonly fees: readonly FeeScheduleData[]
  /** Operator-scoped classes (from #528's /vehicle-classes/manage), used to
   *  resolve a fee's class name and to feed the form's dropdown. */
  readonly classes: readonly FeeClassOption[]
  readonly scope: OperatorScope
}

// Controlled list + empty state. The route owns the loader / useSuspenseQuery
// for BOTH the fees and the operator-scoped classes (FC/IS — shell does I/O,
// this renders). The Add/Edit/Archive dialogs own their write mutations and
// invalidate FEE_QUERY_KEY on success, so the prefetched list refetches.
//
// In all-mode (a cross-operator reader with no picked operator) the page is
// read-only: `canWrite` is false so no write affordances render, and
// `showOperator` turns on the per-row operator label so the mixed-tenant list is
// legible. #1442: writes are picker-aware — a picker admin who has chosen an
// operator (`canWrite` true, `pickedOperatorId` set) threads that id into the
// create body and the update/archive `?operatorId=` so the write binds to the
// chosen tenant; an operator session omits it and is tenant-clamped server-side.
export function OperatorFeesView({ fees, classes, scope }: OperatorFeesViewProps) {
  const { pickedOperatorId, canWrite, showOperator, operatorNameById } = scope
  const t = useTranslations('business.fees')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<FeeScheduleData | null>(null)
  const [archiving, setArchiving] = useState<FeeScheduleData | null>(null)

  const classNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of classes) map.set(c.id, c.name)
    return map
  }, [classes])

  const sorted = useMemo(() => [...fees].sort((a, b) => a.feeType.localeCompare(b.feeType)), [fees])

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="flex items-center justify-end">
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="size-4 mr-1.5" />
            {t('addFee')}
          </Button>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-center py-20">
          <Receipt className="size-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((fee) => (
            <FeeRow
              key={fee.id}
              fee={fee}
              className={
                fee.vehicleClassId ? (classNameById.get(fee.vehicleClassId) ?? null) : null
              }
              canWrite={canWrite}
              operatorName={showOperator ? operatorNameById.get(fee.operatorId) : undefined}
              onEdit={setEditing}
              onArchive={setArchiving}
            />
          ))}
        </div>
      )}

      {canWrite ? (
        <>
          <AddFeeDialog
            open={showAdd}
            onOpenChange={setShowAdd}
            classes={classes}
            pickedOperatorId={pickedOperatorId}
          />
          <EditFeeDialog
            fee={editing}
            onOpenChange={() => setEditing(null)}
            classes={classes}
            pickedOperatorId={pickedOperatorId}
          />
          <ArchiveFeeDialog
            fee={archiving}
            onOpenChange={() => setArchiving(null)}
            pickedOperatorId={pickedOperatorId}
          />
        </>
      ) : null}
    </div>
  )
}
