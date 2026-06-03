'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchInsuranceOptionsAction } from '@/modules/insurance/actions'
import type { InsuranceOptionData } from '@/modules/insurance/api'
import { AddInsuranceDialog } from '@/modules/insurance/components/AddInsuranceDialog'
import { EditInsuranceDialog } from '@/modules/insurance/components/EditInsuranceDialog'
import { InsuranceArchiveDialog } from '@/modules/insurance/components/InsuranceArchiveDialog'
import { InsuranceRow } from '@/modules/insurance/components/InsuranceRow'
import { insuranceKeys } from '@/modules/insurance/hooks'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Plus, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

const SKELETON_KEYS = ['a', 'b', 'c', 'd'] as const

export function InsuranceList() {
  const t = useTranslations('business.insurance')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<InsuranceOptionData | null>(null)
  const [archiving, setArchiving] = useState<InsuranceOptionData | null>(null)

  const {
    data: options,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: insuranceKeys.list(),
    queryFn: async () => {
      // includeArchived=true so the owner sees soft-deleted options and can
      // tell why a name is taken. Archived rows render with a muted badge.
      const result = await fetchInsuranceOptionsAction({ includeArchived: true })
      if (!result.success) throw new Error(result.error)
      return result.data
    },
  })

  const sorted = useMemo(() => {
    if (!options) return []
    // API already returns name-asc but defend against drift.
    return [...options].sort((a, b) => a.name.localeCompare(b.name))
  }, [options])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="size-4 mr-1.5" />
          {t('addOption')}
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className="h-24 rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && isError && (
        <div className="border border-destructive/30 bg-destructive/5 rounded-xl p-6 text-center">
          <AlertCircle className="size-8 text-destructive mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">{t('loadError')}</p>
          <p className="mt-1 text-xs text-muted-foreground break-words">
            {error instanceof Error ? error.message : String(error)}
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            {t('retry')}
          </Button>
        </div>
      )}

      {!isLoading && !isError && sorted.length === 0 && (
        <div className="text-center py-20">
          <ShieldCheck className="size-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">{t('empty')}</p>
        </div>
      )}

      {!isLoading && !isError && sorted.length > 0 && (
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
