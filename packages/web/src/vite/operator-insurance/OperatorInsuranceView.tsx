import { Button } from '@/components/ui/button'
import { AddInsuranceDialog } from '@/vite/operator-insurance/AddInsuranceDialog'
import { EditInsuranceDialog } from '@/vite/operator-insurance/EditInsuranceDialog'
import { InsuranceArchiveDialog } from '@/vite/operator-insurance/InsuranceArchiveDialog'
import { InsuranceRow } from '@/vite/operator-insurance/InsuranceRow'
import type { InsuranceOptionData } from '@/vite/operator-insurance/api'
import { Plus, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslations } from 'use-intl'

interface OperatorInsuranceViewProps {
  readonly options: readonly InsuranceOptionData[]
}

// Controlled list + empty state. The route owns the loader / useSuspenseQuery
// and the pending/error boundaries (FC/IS — the shell does I/O, this renders).
// The Add/Edit/Archive dialogs own their own write mutations and invalidate the
// route's INSURANCE_QUERY_KEY on success, so the prefetched list refetches.
export function OperatorInsuranceView({ options }: OperatorInsuranceViewProps) {
  const t = useTranslations('business.insurance')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<InsuranceOptionData | null>(null)
  const [archiving, setArchiving] = useState<InsuranceOptionData | null>(null)

  // API already returns name-asc, but defend against drift.
  const sorted = useMemo(() => [...options].sort((a, b) => a.name.localeCompare(b.name)), [options])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="size-4 mr-1.5" />
          {t('addOption')}
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-20">
          <ShieldCheck className="size-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((o) => (
            <InsuranceRow key={o.id} option={o} onEdit={setEditing} onArchive={setArchiving} />
          ))}
        </div>
      )}

      <AddInsuranceDialog open={showAdd} onOpenChange={setShowAdd} />
      <EditInsuranceDialog option={editing} onOpenChange={() => setEditing(null)} />
      <InsuranceArchiveDialog option={archiving} onOpenChange={() => setArchiving(null)} />
    </div>
  )
}
