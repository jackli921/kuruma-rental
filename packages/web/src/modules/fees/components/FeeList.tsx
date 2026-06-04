'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { type VehicleClassData, classKeys, fetchClassesAction } from '@/modules/classes'
import { fetchFeeSchedulesAction } from '@/modules/fees/actions'
import type { FeeScheduleData } from '@/modules/fees/api'
import { AddFeeDialog } from '@/modules/fees/components/AddFeeDialog'
import { ArchiveFeeDialog } from '@/modules/fees/components/ArchiveFeeDialog'
import { EditFeeDialog } from '@/modules/fees/components/EditFeeDialog'
import { FeeRow } from '@/modules/fees/components/FeeRow'
import { feeKeys } from '@/modules/fees/hooks'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Plus, Receipt } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

const SKELETON_KEYS = ['a', 'b', 'c'] as const

export function FeeList() {
  const t = useTranslations('business.fees')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<FeeScheduleData | null>(null)
  const [archiving, setArchiving] = useState<FeeScheduleData | null>(null)

  const {
    data: fees,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: feeKeys.list(),
    queryFn: async () => {
      // includeArchived so the owner sees archived fees and understands why a
      // (type, scope) slot is taken. Archived rows render with a muted badge.
      const result = await fetchFeeSchedulesAction({ includeArchived: true })
      if (!result.success) throw new Error(result.error)
      return result.data
    },
  })

  // The class dropdown offers only the operator's OWN active classes; the JWT
  // scopes the API, so this returns just this operator's classes.
  const { data: classes } = useQuery({
    queryKey: [...classKeys.list(), 'for-fees'],
    queryFn: async () => {
      const result = await fetchClassesAction()
      if (!result.success) throw new Error(result.error)
      return result.data
    },
  })

  const classList: VehicleClassData[] = classes ?? []
  const classNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of classList) map.set(c.id, c.name)
    return map
  }, [classList])

  const sorted = useMemo(() => {
    if (!fees) return []
    return [...fees].sort((a, b) => a.feeType.localeCompare(b.feeType))
  }, [fees])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="size-4 mr-1.5" />
          {t('addFee')}
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className="h-20 rounded-lg" />
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
          <Receipt className="size-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">{t('empty')}</p>
        </div>
      )}

      {!isLoading && !isError && sorted.length > 0 && (
        <div className="space-y-3">
          {sorted.map((fee) => (
            <FeeRow
              key={fee.id}
              fee={fee}
              className={
                fee.vehicleClassId ? (classNameById.get(fee.vehicleClassId) ?? null) : null
              }
              onEdit={setEditing}
              onArchive={setArchiving}
            />
          ))}
        </div>
      )}

      <AddFeeDialog open={showAdd} onOpenChange={setShowAdd} classes={classList} />
      <EditFeeDialog fee={editing} onOpenChange={() => setEditing(null)} classes={classList} />
      <ArchiveFeeDialog fee={archiving} onOpenChange={() => setArchiving(null)} />
    </div>
  )
}
