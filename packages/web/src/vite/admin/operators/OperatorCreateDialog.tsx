import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

interface OperatorCreateDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly isPending: boolean
  readonly error: string | null
  readonly onSubmit: (input: { name: string; preAuthHandoffUrl?: string }) => void
}

/**
 * Create a marketplace operator (#1088). Pure presentational: the route owns the
 * `createOperator` mutation. The slug is server-derived from the name, so only a
 * name (required) + optional pre-auth handoff URL are collected. Local state
 * resets on close so the form is blank on the next open.
 */
export function OperatorCreateDialog({
  open,
  onOpenChange,
  isPending,
  error,
  onSubmit,
}: OperatorCreateDialogProps) {
  const t = useTranslations('admin.operators.createDialog')
  const [name, setName] = useState('')
  const [handoffUrl, setHandoffUrl] = useState('')

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName('')
      setHandoffUrl('')
    }
    onOpenChange(next)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedUrl = handoffUrl.trim()
    onSubmit({ name: name.trim(), ...(trimmedUrl ? { preAuthHandoffUrl: trimmedUrl } : {}) })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="px-1 text-destructive text-sm">{error}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="operator-create-name">{t('nameLabel')}</Label>
            <Input
              id="operator-create-name"
              required
              autoComplete="off"
              placeholder={t('namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="operator-create-handoff">{t('handoffLabel')}</Label>
            <Input
              id="operator-create-handoff"
              type="url"
              autoComplete="off"
              placeholder={t('handoffPlaceholder')}
              value={handoffUrl}
              onChange={(e) => setHandoffUrl(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={isPending || name.trim().length === 0}>
              {isPending ? t('submitting') : t('submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
