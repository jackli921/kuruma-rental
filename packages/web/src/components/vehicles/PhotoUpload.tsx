'use client'

import { deleteVehiclePhotoAction, uploadVehiclePhotosAction } from '@/lib/vehicle-actions'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useCallback, useRef, useState } from 'react'

const MAX_PHOTOS = 10
const MAX_SIZE_MB = 5
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

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
  const [deleting, setDeleting] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['vehicles'] })
  }, [queryClient])

  const validateAndUpload = useCallback(
    async (files: File[]) => {
      setError(null)

      const imageFiles = files.filter((f) => f.type.startsWith('image/'))
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
    [vehicleId, photos.length, t, invalidate],
  )

  const handleDelete = useCallback(
    async (idx: number) => {
      setError(null)
      setDeleting(idx)

      const result = await deleteVehiclePhotoAction(vehicleId, idx)
      setDeleting(null)

      if (!result.success) {
        setError(result.error)
        return
      }

      setPhotos((prev) => prev.filter((_, i) => i !== idx))
      invalidate()
    },
    [vehicleId, invalidate],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) validateAndUpload(files)
    },
    [validateAndUpload],
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
      <p className="text-xs text-muted-foreground">
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
                onClick={() => handleDelete(idx)}
                disabled={deleting === idx}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                aria-label={t('deletePhoto')}
              >
                {deleting === idx ? '...' : '\u00d7'}
              </button>
            </div>
          ))}
        </div>
      )}

      {photos.length < MAX_PHOTOS && (
        <button
          type="button"
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`w-full border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/50'
          }`}
          onClick={() => fileInputRef.current?.click()}
          aria-label={t('uploadPhotos')}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
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
