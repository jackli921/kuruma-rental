'use client'

import { deleteVehiclePhotoAction, uploadVehiclePhotosAction } from '@/lib/vehicle-actions'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useCallback, useRef, useState } from 'react'

const MAX_PHOTOS = 10
const MAX_SIZE_MB = 5
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const ACCEPT = Array.from(ALLOWED_TYPES).join(',')

interface PhotoUploadProps {
  vehicleId: string
  initialPhotos: string[]
}

export function PhotoUpload({ vehicleId, initialPhotos }: PhotoUploadProps) {
  const t = useTranslations('business.vehicles.photos')
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState(initialPhotos)
  const [uploading, setUploading] = useState(false)
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['vehicles'] })
  }, [queryClient])

  const validateAndUpload = useCallback(
    async (files: File[]) => {
      setError(null)

      const imageFiles = files.filter((f) => ALLOWED_TYPES.has(f.type))
      if (imageFiles.length === 0) {
        setError(t('typeError'))
        return
      }

      const oversized = imageFiles.find((f) => f.size > MAX_SIZE_BYTES)
      if (oversized) {
        setError(t('sizeLimit', { max: MAX_SIZE_MB }))
        return
      }

      if (photos.length + imageFiles.length > MAX_PHOTOS) {
        setError(t('photoLimit', { max: MAX_PHOTOS }))
        return
      }

      setUploading(true)
      const formData = new FormData()
      for (const file of imageFiles) {
        formData.append('file', file)
      }

      const result = await uploadVehiclePhotosAction(vehicleId, formData)
      setUploading(false)

      if (!result.success) {
        setError(result.error)
        return
      }

      setPhotos((prev) => [...prev, ...result.data.uploaded])
      invalidate()
    },
    [vehicleId, t, invalidate, photos.length],
  )

  const handleDelete = useCallback(
    async (url: string) => {
      setError(null)
      setDeletingUrl(url)

      const result = await deleteVehiclePhotoAction(vehicleId, url)
      setDeletingUrl(null)

      if (!result.success) {
        setError(result.error)
        return
      }

      setPhotos((prev) => prev.filter((u) => u !== url))
      invalidate()
    },
    [vehicleId, invalidate],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (uploading) return
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) validateAndUpload(files)
    },
    [validateAndUpload, uploading],
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      if (files.length > 0) validateAndUpload(files)
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [validateAndUpload],
  )

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">{t('heading')}</div>
      <p className="text-xs text-muted-foreground" id="photo-upload-hint">
        {t('hint', { max: MAX_PHOTOS, maxSize: MAX_SIZE_MB })}
      </p>

      {photos.length > 0 && (
        <div className="grid grid-cols-5 gap-2">
          {photos.map((url, idx) => (
            <div key={url} className="relative group aspect-square">
              <img
                src={url}
                alt={t('photoAlt', { index: idx + 1 })}
                className="w-full h-full object-cover rounded-md border"
              />
              <button
                type="button"
                onClick={() => handleDelete(url)}
                disabled={deletingUrl === url}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                aria-label={t('deletePhoto')}
              >
                {deletingUrl === url ? '...' : '\u00d7'}
              </button>
            </div>
          ))}
        </div>
      )}

      {photos.length < MAX_PHOTOS && (
        <button
          type="button"
          disabled={uploading}
          onDragOver={(e) => {
            e.preventDefault()
            if (!uploading) setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`w-full border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/50'
          }`}
          onClick={() => fileInputRef.current?.click()}
          aria-label={t('uploadPhotos')}
          aria-describedby="photo-upload-hint"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          <p className="text-sm text-muted-foreground">
            {uploading ? t('uploading') : t('uploadPhotos')}
          </p>
        </button>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
