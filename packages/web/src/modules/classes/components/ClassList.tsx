'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { vehicleKeys } from '@/lib/query-keys'
import { fetchFleetOverviewAction } from '@/lib/vehicle-actions'
import { fetchClassesAction } from '@/modules/classes/actions'
import type { VehicleClassData } from '@/modules/classes/api'
import { AddClassDialog } from '@/modules/classes/components/AddClassDialog'
import { ClassRow } from '@/modules/classes/components/ClassRow'
import { DeleteClassDialog } from '@/modules/classes/components/DeleteClassDialog'
import { EditClassDialog } from '@/modules/classes/components/EditClassDialog'
import { classKeys } from '@/modules/classes/hooks'
import { computeClassStats } from '@/modules/classes/stats'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, LayersIcon, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

const SKELETON_KEYS = ['a', 'b', 'c', 'd'] as const

export function ClassList() {
  const t = useTranslations('business.classes')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<VehicleClassData | null>(null)
  const [deleting, setDeleting] = useState<VehicleClassData | null>(null)

  const {
    data: classes,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: classKeys.list(),
    queryFn: async () => {
      // includeArchived=true so the owner sees soft-deleted classes and can
      // tell why a slug is taken. Archived rows render with a muted badge.
      const result = await fetchClassesAction({ includeArchived: true })
      if (!result.success) throw new Error(result.error)
      return result.data
    },
  })

  // Fleet overview powers per-class stats (cars + active bookings). Shared
  // cache key with the Fleet page means we don't double-fetch on nav.
  const { data: fleet } = useQuery({
    queryKey: vehicleKeys.fleetOverview,
    queryFn: async () => {
      const result = await fetchFleetOverviewAction()
      if (!result.success) throw new Error(result.error)
      return result.data
    },
  })

  const sorted = useMemo(() => {
    if (!classes) return []
    // API already returns sortOrder-asc but defend against drift.
    return [...classes].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return a.name.localeCompare(b.name)
    })
  }, [classes])

  const deletingStats = useMemo(() => {
    if (!deleting) return null
    return computeClassStats(deleting.id, fleet ?? [])
  }, [deleting, fleet])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="size-4 mr-1.5" />
          {t('addClass')}
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
          <LayersIcon className="size-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">{t('empty')}</p>
        </div>
      )}

      {!isLoading && !isError && sorted.length > 0 && (
        <div className="space-y-3">
          {sorted.map((c) => (
            <ClassRow
              key={c.id}
              vehicleClass={c}
              stats={computeClassStats(c.id, fleet ?? [])}
              onEdit={setEditing}
              onDelete={setDeleting}
            />
          ))}
        </div>
      )}

      <AddClassDialog open={showAdd} onOpenChange={setShowAdd} />
      <EditClassDialog vehicleClass={editing} onOpenChange={() => setEditing(null)} />
      <DeleteClassDialog
        vehicleClass={deleting}
        stats={deletingStats}
        onOpenChange={() => setDeleting(null)}
      />
    </div>
  )
}
