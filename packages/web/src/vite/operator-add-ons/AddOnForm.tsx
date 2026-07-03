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

// Catalog i18n: an add-on is one of two shapes (#1437). PICKED — the operator selects
// a platform template (the picker already excludes ones they offer) and the template
// owns the localized name. SELF-AUTHORED ("custom") — the operator writes their own
// en/ja/zh name bundle. In CREATE mode a toggle chooses the path; in EDIT mode the
// identity is fixed (a picked template is read-only; a custom name stays editable so
// the operator can add ja/zh or fix en later, D5). Both edit the price and a single
// description slot in the caller's UI locale (the dialog maps it into the bag).
export type AddOnIdentityMode = 'template' | 'custom'

export interface AddOnFormValues {
  identityMode: AddOnIdentityMode
  templateId: string
  nameEn: string
  nameJa: string
  nameZh: string
  priceJpy: number
  description: string
}

const priceField = z
  .number()
  .int('Price must be a whole number of yen')
  .min(0, 'Price cannot be negative')

// One schema for both modes: `identityMode` decides which identity field is required.
// A PICKED create needs a templateId; a CUSTOM create/edit needs an English name (the
// guaranteed fallback). ja/zh stay optional — nudged, never required.
const formSchema = z
  .object({
    identityMode: z.enum(['template', 'custom']),
    templateId: z.string(),
    nameEn: z.string(),
    nameJa: z.string(),
    nameZh: z.string(),
    priceJpy: priceField,
    description: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.identityMode === 'template' && values.templateId.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['templateId'],
        message: 'Select an add-on template',
      })
    }
    if (values.identityMode === 'custom' && values.nameEn.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nameEn'],
        message: 'Enter an English name',
      })
    }
  })

interface AddOnFormProps {
  mode: 'create' | 'edit'
  onSubmit: (data: AddOnFormValues) => Promise<void>
  onCancel?: () => void
  isSubmitting?: boolean
  /** CREATE: the templates to pick from (already excludes ones the operator offers). */
  templates?: readonly AddOnTemplatePickerData[]
  /** EDIT (picked): the fixed template's resolved name, shown read-only. */
  templateName?: string
  /** EDIT: which identity the edited row uses. A custom row edits its name (D5). */
  editIdentity?: AddOnIdentityMode
  defaultValues?: Partial<AddOnFormValues>
}

export function AddOnForm({
  mode,
  onSubmit,
  onCancel,
  isSubmitting,
  templates,
  templateName,
  editIdentity,
  defaultValues,
}: AddOnFormProps) {
  const t = useTranslations('business.addOns')

  // The 3-generic useForm + valueAsNumber lets the zod resolver coerce the numeric
  // input: an empty field is NaN, so a `0` default keeps the integer schema satisfied
  // until the operator types a price (per-booking, flat).
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<AddOnFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      identityMode: mode === 'edit' ? (editIdentity ?? 'template') : 'template',
      templateId: '',
      nameEn: '',
      nameJa: '',
      nameZh: '',
      priceJpy: 0,
      description: '',
      ...defaultValues,
    },
  })

  // In CREATE mode the operator toggles the path; in EDIT it is fixed by the row.
  const identityMode = watch('identityMode')
  const showPicker = mode === 'create' && identityMode === 'template'
  const showCustomName = identityMode === 'custom'
  const showReadOnlyTemplate = mode === 'edit' && identityMode === 'template'

  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        await onSubmit(data)
      })}
      className="space-y-4"
    >
      {mode === 'create' && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{t('form.identityLegend')}</legend>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" value="template" {...register('identityMode')} />
              {t('form.identityTemplate')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" value="custom" {...register('identityMode')} />
              {t('form.identityCustom')}
            </label>
          </div>
        </fieldset>
      )}

      {showPicker && (
        <div>
          <Label htmlFor="addon-template">{t('form.template')}</Label>
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
          {errors.templateId && (
            <p className="text-sm text-destructive mt-1">{errors.templateId.message}</p>
          )}
        </div>
      )}

      {showReadOnlyTemplate && (
        <div>
          <Label>{t('form.template')}</Label>
          <p className="flex h-9 items-center px-3 text-sm text-muted-foreground">{templateName}</p>
          <input type="hidden" {...register('templateId')} />
        </div>
      )}

      {showCustomName && (
        <fieldset className="space-y-2">
          <div>
            <Label htmlFor="addon-name-en">{t('form.nameEn')}</Label>
            <Input
              id="addon-name-en"
              aria-invalid={errors.nameEn ? true : undefined}
              {...register('nameEn')}
            />
            {errors.nameEn && (
              <p className="text-sm text-destructive mt-1">{errors.nameEn.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="addon-name-ja">{t('form.nameJa')}</Label>
            <Input id="addon-name-ja" {...register('nameJa')} />
          </div>
          <div>
            <Label htmlFor="addon-name-zh">{t('form.nameZh')}</Label>
            <Input id="addon-name-zh" {...register('nameZh')} />
          </div>
          {/* Tourists read English wherever ja/zh are blank — nudge, never require. */}
          <p className="text-xs text-muted-foreground">{t('form.customNameNudge')}</p>
        </fieldset>
      )}

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
