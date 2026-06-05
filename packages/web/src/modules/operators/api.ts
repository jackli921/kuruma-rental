import { createApiClient } from '@/lib/api-client'
import { unwrap } from '@/lib/api-error'

// JSON-serialized operator option for the admin picker (#407). The list
// endpoint returns only the fields the picker needs (id + display name + slug).
export interface OperatorOption {
  id: string
  name: string
  slug: string
}

// Lists the operators the caller may write under. Bypass roles see all
// operators; an OPERATOR_* caller sees only its own (scoped server-side).
export async function fetchOperators(token?: string): Promise<OperatorOption[]> {
  const client = createApiClient(token)
  const res = await client.operators.$get()
  return unwrap<OperatorOption[]>(res)
}
