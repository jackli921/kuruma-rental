'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchLocationsAction } from '@/modules/locations/actions'
import type { LocationData } from '@/modules/locations/api'
import { AddLocationDialog } from '@/modules/locations/components/AddLocationDialog'
import { ArchiveLocationDialog } from '@/modules/locations/components/ArchiveLocationDialog'
import { EditLocationDialog } from '@/modules/locations/components/EditLocationDialog'
import { LocationRow } from '@/modules/locations/components/LocationRow'
import { locationKeys } from '@/modules/locations/hooks'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, MapPin, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

const SKELETON_KEYS = ['a', 'b', 'c', 'd'] as const

export function LocationList() {
  const t = useTranslations('business.locations')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<LocationData | null>(null)
  const [archiving, setArchiving] = useState<LocationData | null>(null)

  const {
    data: locations,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: locationKeys.list(),
    queryFn: async () => {
      // includeArchived=true so the owner sees soft-deleted locations and can
      // tell why a name is taken. Archived rows render with a muted badge.
      const result = await fetchLocationsAction({ includeArchived: true })
      if (!result.success) throw new Error(result.error)
      return result.data
    },
  })

  const sorted = useMemo(() => {
    if (!locations) return []
    // API already returns name-asc but defend against drift.
    return [...locations].sort((a, b) => a.name.localeCompare(b.name))
  }, [locations])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="size-4 mr-1.5" />
          {t('addLocation')}
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
          <MapPin className="size-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">{t('empty')}</p>
        </div>
      )}

      {!isLoading && !isError && sorted.length > 0 && (
        <div className="space-y-3">
          {sorted.map((l) => (
            <LocationRow key={l.id} location={l} onEdit={setEditing} onArchive={setArchiving} />
          ))}
        </div>
      )}

      <AddLocationDialog open={showAdd} onOpenChange={setShowAdd} />
      <EditLocationDialog location={editing} onOpenChange={() => setEditing(null)} />
      <ArchiveLocationDialog location={archiving} onOpenChange={() => setArchiving(null)} />
    </div>
  )
}
