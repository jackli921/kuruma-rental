import { FLEET_QUERY_KEY, deleteVehiclePhoto, uploadVehiclePhotos } from '@/vite/operator-fleet/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ChangeEvent, useRef, useState } from 'react'
import { useTranslations } from 'use-intl'

// Mirror of the server's per-file ceiling (`MAX_FILE_SIZE` in
// packages/api/src/services/vehicle-photo.ts = 5 * 1024 * 1024). The route 413s
// the whole multipart body and the service rejects per-file over this; we guard
// client-side so an oversize pick fails instantly instead of round-tripping.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const MAX_PHOTO_MB = MAX_PHOTO_BYTES / (1024 * 1024)
// Mirror of the server's per-vehicle cap (`MAX_PHOTOS_PER_VEHICLE` in
// packages/api/src/services/vehicle-photo.ts). Named so the hint can't silently
// drift from the server limit — change both or neither.
const MAX_PHOTOS = 10
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif'

interface PhotoUploadProps {
  /** The vehicle to attach photos to. `null` = create mode: photos upload only
   *  after the vehicle is saved, so the control renders disabled with a hint. */
  readonly vehicleId: string | null
  /** Current photo URLs, passed down from the fleet read model. Defaults to []. */
  readonly photos?: readonly string[]
  // #1260: a picker-admin binds photo writes to the operator it picked; undefined
  // for an operator session (the API scopes those by the session cookie).
  readonly pickedOperatorId?: string | undefined
}

/**
 * Controlled photo-management control for the operator fleet form (#557). Owns
 * no routing or global state: it takes the vehicle id + current photos as props
 * and reports changes by invalidating the shared fleet query so the parent
 * re-derives. A client-side size guard mirrors the server's per-file limit
 * (FC/IS — the pure `exceedsLimit` decision; mutations are the I/O shell).
 */
export function PhotoUpload({ vehicleId, photos = [], pickedOperatorId }: PhotoUploadProps) {
  const t = useTranslations('business.vehicles.photos')
  const queryClient = useQueryClient()
  // Cookie writes need the double-submit CSRF token echoed in the header (#1304).
  const csrfToken = useSession().data?.csrfToken ?? ''
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const invalidateFleet = () => queryClient.invalidateQueries({ queryKey: FLEET_QUERY_KEY })

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => {
      if (!vehicleId) throw new Error('vehicleId required to upload')
      return uploadVehiclePhotos(vehicleId, files, csrfToken, pickedOperatorId)
    },
    onSuccess: invalidateFleet,
    onError: (e) => setError(e instanceof Error ? e.message : t('uploading')),
  })

  const deleteMutation = useMutation({
    mutationFn: (url: string) => {
      if (!vehicleId) throw new Error('vehicleId required to delete')
      return deleteVehiclePhoto(vehicleId, url, csrfToken, pickedOperatorId)
    },
    onSuccess: invalidateFleet,
    onError: (e) => setError(e instanceof Error ? e.message : t('deletePhoto')),
  })

  function handleSelect(e: ChangeEvent<HTMLInputElement>): void {
    setError(null)
    const files = Array.from(e.target.files ?? [])
    if (inputRef.current) inputRef.current.value = ''
    if (files.length === 0) return

    if (files.some((f) => f.size > MAX_PHOTO_BYTES)) {
      setError(t('sizeLimit', { max: MAX_PHOTO_MB }))
      return
    }
    uploadMutation.mutate(files)
  }

  const disabled = vehicleId === null || uploadMutation.isPending

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">{t('heading')}</div>

      {photos.length > 0 && (
        <ul className="grid grid-cols-5 gap-2">
          {photos.map((url, idx) => (
            <li key={url} className="group relative aspect-square">
              <img
                src={url}
                alt={t('photoAlt', { index: idx + 1 })}
                className="h-full w-full rounded-md border object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  deleteMutation.mutate(url)
                }}
                disabled={deleteMutation.isPending || vehicleId === null}
                aria-label={t('deletePhoto')}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-50"
              >
                {'×'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="block">
        <span className="sr-only">{t('uploadPhotos')}</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          disabled={disabled}
          onChange={handleSelect}
          aria-label={t('uploadPhotos')}
          className="block w-full text-sm disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>

      {vehicleId === null ? (
        <p className="text-xs text-muted-foreground">
          {t('hint', { max: MAX_PHOTOS, maxSize: MAX_PHOTO_MB })}
        </p>
      ) : (
        uploadMutation.isPending && (
          <p className="text-sm text-muted-foreground">{t('uploading')}</p>
        )
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
