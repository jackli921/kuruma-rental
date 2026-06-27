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

interface OperatorEditDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The operator being renamed; its name seeds the field. Null when closed. */
  readonly operator: { id: string; name: string } | null
  readonly isPending: boolean
  readonly error: string | null
  readonly onSubmit: (input: { name: string }) => void
}

/**
 * Rename an operator (#1088). Pure presentational: the route owns the
 * `editOperator` mutation and remounts this per operator (`key={operator.id}`) so
 * the field re-seeds. Scoped to the display name — `preAuthHandoffUrl` is an
 * owner-tier money-flow control managed in the operator's own portal (#903), so
 * the admin rename path deliberately leaves it untouched. The slug is immutable.
 */
export function OperatorEditDialog({
  open,
  onOpenChange,
  operator,
  isPending,
  error,
  onSubmit,
}: OperatorEditDialogProps) {
  const t = useTranslations('admin.operators.editDialog')
  const [name, setName] = useState(operator?.name ?? '')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit({ name: name.trim() })
          }}
          className="space-y-4"
        >
          {error && <p className="px-1 text-destructive text-sm">{error}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="operator-edit-name">{t('nameLabel')}</Label>
            <Input
              id="operator-edit-name"
              required
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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
