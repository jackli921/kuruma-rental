import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import {
  type TemplateLibraryResponse,
  templateLibraryResponseSchema,
} from '@kuruma/shared/types/template-admin'
import { queryOptions } from '@tanstack/react-query'

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
