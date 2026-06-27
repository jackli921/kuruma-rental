import { Button } from '@/components/ui/button'
import { AddAddOnDialog } from '@/vite/operator-add-ons/AddAddOnDialog'
import { AddOnArchiveDialog } from '@/vite/operator-add-ons/AddOnArchiveDialog'
import { AddOnRow } from '@/vite/operator-add-ons/AddOnRow'
import { EditAddOnDialog } from '@/vite/operator-add-ons/EditAddOnDialog'
import type { AddOnData } from '@/vite/operator-add-ons/api'
import { PackagePlus, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslations } from 'use-intl'

interface OperatorAddOnsViewProps {
  readonly addOns: readonly AddOnData[]
  readonly canWrite: boolean
  readonly showOperator: boolean
  readonly operatorNameById: ReadonlyMap<string, string>
  readonly pickedOperatorId?: string | undefined
}

// Controlled list + empty state. The route owns the loader / useSuspenseQuery
// and the pending/error boundaries (FC/IS — the shell does I/O, this renders).
// The Add/Edit/Archive dialogs own their own write mutations and invalidate the
// route's ADDON_QUERY_KEY on success, so the prefetched list refetches.
//
// In all-mode (a cross-operator reader with no picked operator) the page is
// read-only: `canWrite` is false so no write affordances render, and
// `showOperator` turns on the per-row operator label so the mixed-tenant list is
// legible. A scoped write (operator session, or admin who picked a tenant) shows
// the Add/Edit/Archive controls and threads `pickedOperatorId` into the create.
export function OperatorAddOnsView({
  addOns,
  canWrite,
  showOperator,
  operatorNameById,
  pickedOperatorId,
}: OperatorAddOnsViewProps) {
  const t = useTranslations('business.addOns')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<AddOnData | null>(null)
  const [archiving, setArchiving] = useState<AddOnData | null>(null)

  // API already returns name-asc, but defend against drift.
  const sorted = useMemo(() => [...addOns].sort((a, b) => a.name.localeCompare(b.name)), [addOns])

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="flex items-center justify-end">
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="size-4 mr-1.5" />
            {t('addOption')}
          </Button>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-center py-20">
          <PackagePlus className="size-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((a) => (
            <AddOnRow
              key={a.id}
              addOn={a}
              canWrite={canWrite}
              operatorName={showOperator ? operatorNameById.get(a.operatorId) : undefined}
              onEdit={setEditing}
              onArchive={setArchiving}
            />
          ))}
        </div>
      )}

      {canWrite ? (
        <>
          <AddAddOnDialog
            open={showAdd}
            onOpenChange={setShowAdd}
            pickedOperatorId={pickedOperatorId}
          />
          <EditAddOnDialog addOn={editing} onOpenChange={() => setEditing(null)} />
          <AddOnArchiveDialog addOn={archiving} onOpenChange={() => setArchiving(null)} />
        </>
      ) : null}
    </div>
  )
}
