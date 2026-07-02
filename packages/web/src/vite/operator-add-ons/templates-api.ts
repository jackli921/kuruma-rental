import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { Locale } from '@kuruma/shared/i18n/locales'
import type { AddOnTemplatePickerData } from '@kuruma/shared/types/add-on-template'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// The platform-owned add-on TEMPLATE picker (catalog i18n, epic #385). An operator
// picks a template when authoring an add-on; the server resolves each name to
// `?locale=` and EXCLUDES templates the target operator already offers on an ACTIVE
// add-on, so the list can never surface a duplicate. An operator session
// auto-scopes to itself; a platform admin who has picked a tenant names it via
// `?operatorId` so the exclusion targets that tenant.

const templateSchema = z.object({
  id: z.string(),
  key: z.string(),
  resolvedName: z.string(),
}) satisfies z.ZodType<AddOnTemplatePickerData>

export const ADDON_TEMPLATE_QUERY_KEY = ['operator-add-on-templates'] as const

export async function fetchAddOnTemplates(
  locale: Locale,
  pickedOperatorId?: string,
): Promise<AddOnTemplatePickerData[]> {
  const scope = pickedOperatorId ? `&operatorId=${encodeURIComponent(pickedOperatorId)}` : ''
  const res = await fetch(`${getApiBaseUrl()}/add-on-templates?locale=${locale}${scope}`, {
    credentials: 'include',
  })
  return unwrap(res, templateSchema.array())
}

// Keyed by picked tenant + locale: the exclusion set is per-operator and the
// resolved names are per-locale, so both must partition the cache.
export function addOnTemplatesQueryOptions(locale: Locale, pickedOperatorId?: string) {
  return queryOptions({
    queryKey: [...ADDON_TEMPLATE_QUERY_KEY, pickedOperatorId ?? 'self', locale] as const,
    queryFn: () => fetchAddOnTemplates(locale, pickedOperatorId),
  })
}
