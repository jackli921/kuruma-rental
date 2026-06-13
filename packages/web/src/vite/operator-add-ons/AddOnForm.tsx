import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import { type CreateAddOnInput, createAddOnSchema } from '@kuruma/shared/validators/add-on'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import type { z } from 'zod'

type AddOnFormValues = z.input<typeof createAddOnSchema>
type AddOnFormOutput = z.output<typeof createAddOnSchema>

interface AddOnFormProps {
  onSubmit: (data: CreateAddOnInput) => Promise<void>
  onCancel?: () => void
  defaultValues?: Partial<CreateAddOnInput>
  isSubmitting?: boolean
}

export function AddOnForm({ onSubmit, onCancel, defaultValues, isSubmitting }: AddOnFormProps) {
  const t = useTranslations('business.addOns')

  // The 3-generic useForm + valueAsNumber lets the zod resolver coerce the
  // numeric input: an empty field is NaN, so a `0` default keeps the integer
  // schema satisfied until the operator types a price (per-booking, flat).
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddOnFormValues, unknown, AddOnFormOutput>({
    resolver: zodResolver(createAddOnSchema),
    defaultValues: {
      name: '',
      description: null,
      priceJpy: 0,
      ...defaultValues,
    },
  })

  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        await onSubmit(data)
      })}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="addon-name">{t('form.name')}</Label>
        <Input id="addon-name" placeholder={t('form.namePlaceholder')} {...register('name')} />
        {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
      </div>

      <div>
        <Label htmlFor="addon-description">{t('form.description')}</Label>
        <Textarea
          id="addon-description"
          placeholder={t('form.descriptionPlaceholder')}
          {...register('description')}
        />
        {errors.description && (
          <p className="text-sm text-destructive mt-1">{errors.description.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="addon-price">{t('form.price')}</Label>
        <Input id="addon-price" type="number" {...register('priceJpy', { valueAsNumber: true })} />
        <p className="text-xs text-muted-foreground mt-1">{t('form.priceHint')}</p>
        {errors.priceJpy && (
          <p className="text-sm text-destructive mt-1">{errors.priceJpy.message}</p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-4">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('form.cancel')}
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('form.saving') : t('form.save')}
        </Button>
      </div>
    </form>
  )
}
