import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import type { AddOnTemplatePickerData } from '@kuruma/shared/types/add-on-template'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import { z } from 'zod'

// Catalog i18n (slice 2): the operator no longer types a free-text name. In CREATE
// mode they pick a platform template (the picker already excludes ones they offer);
// in EDIT mode the template is the add-on's fixed identity, shown read-only. Both
// modes edit the price and a single description slot in the caller's UI locale — the
// dialog maps that slot into the LocalizedTextOverride bag (see description-override).
export interface AddOnFormValues {
  templateId: string
  priceJpy: number
  description: string
}

const priceField = z
  .number()
  .int('Price must be a whole number of yen')
  .min(0, 'Price cannot be negative')

// Two schemas so a template selection is required only when creating; an edit never
// re-picks the template, so its (carried, ignored) id is unconstrained.
const createSchema = z.object({
  templateId: z.string().min(1, 'Select an add-on template'),
  priceJpy: priceField,
  description: z.string(),
})
const editSchema = z.object({
  templateId: z.string(),
  priceJpy: priceField,
  description: z.string(),
})

interface AddOnFormProps {
  mode: 'create' | 'edit'
  onSubmit: (data: AddOnFormValues) => Promise<void>
  onCancel?: () => void
  isSubmitting?: boolean
  /** CREATE: the templates to pick from (already excludes ones the operator offers). */
  templates?: readonly AddOnTemplatePickerData[]
  /** EDIT: the fixed template's resolved name, shown read-only. */
  templateName?: string
  defaultValues?: Partial<AddOnFormValues>
}

export function AddOnForm({
  mode,
  onSubmit,
  onCancel,
  isSubmitting,
  templates,
  templateName,
  defaultValues,
}: AddOnFormProps) {
  const t = useTranslations('business.addOns')

  // The 3-generic useForm + valueAsNumber lets the zod resolver coerce the numeric
  // input: an empty field is NaN, so a `0` default keeps the integer schema
  // satisfied until the operator types a price (per-booking, flat).
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddOnFormValues>({
    resolver: zodResolver(mode === 'create' ? createSchema : editSchema),
    defaultValues: {
      templateId: '',
      priceJpy: 0,
      description: '',
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
        <Label htmlFor={mode === 'create' ? 'addon-template' : undefined}>
          {t('form.template')}
        </Label>
        {mode === 'create' ? (
          <NativeSelect
            id="addon-template"
            aria-invalid={errors.templateId ? true : undefined}
            {...register('templateId')}
          >
            <option value="">{t('form.templatePlaceholder')}</option>
            {(templates ?? []).map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.resolvedName}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <>
            <p className="flex h-9 items-center px-3 text-sm text-muted-foreground">
              {templateName}
            </p>
            <input type="hidden" {...register('templateId')} />
          </>
        )}
        {errors.templateId && (
          <p className="text-sm text-destructive mt-1">{errors.templateId.message}</p>
        )}
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
