import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import {
  type TemplateAdminRow,
  type TemplateLibraryResponse,
  type TemplatePatch,
  templateAdminRowSchema,
  templateLibraryResponseSchema,
} from '@kuruma/shared/types/template-admin'
import { queryOptions } from '@tanstack/react-query'

/** URL path segment per catalog (the tabbed view keys them `addOns`/`insurance`). */
export type TemplateCatalog = 'add-ons' | 'insurance'

// Platform-admin template library (#1319). Cookie-based (credentials: 'include')
// so the API gates on the session role server-side (requirePlatformRead). The
// response carries the RAW multi-locale bundles — the admin curates them — unlike
// the operator picker which resolves one label. Mirrors admin/anomalies/api.ts.
export const TEMPLATE_LIBRARY_QUERY_KEY = ['admin-template-library'] as const

export async function fetchTemplateLibrary(): Promise<TemplateLibraryResponse> {
  const res = await fetch(`${getApiBaseUrl()}/admin/templates`, { credentials: 'include' })
  return unwrap(res, templateLibraryResponseSchema)
}

export function templateLibraryQueryOptions() {
  return queryOptions({
    queryKey: TEMPLATE_LIBRARY_QUERY_KEY,
    queryFn: fetchTemplateLibrary,
  })
}

// Platform-admin template WRITE (#1319 slice 2). Cookie-authenticated, so it is
// CSRF-gated: the caller echoes the session's token in `X-CSRF-Token`. One PATCH
// both translates (name/description bundles) and promotes/archives (status) — the
// server (requirePlatformAdmin) rejects a non-admin. Returns the updated raw row;
// the caller invalidates TEMPLATE_LIBRARY_QUERY_KEY to refetch the table.
export async function updateTemplate(params: {
  catalog: TemplateCatalog
  id: string
  patch: TemplatePatch
  csrfToken: string
}): Promise<TemplateAdminRow> {
  const { catalog, id, patch, csrfToken } = params
  const res = await fetch(
    `${getApiBaseUrl()}/admin/templates/${catalog}/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(patch),
    },
  )
  return unwrap(res, templateAdminRowSchema)
}
