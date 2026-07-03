import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { CustomersView } from '@/vite/admin/customers/CustomersView'
import { customerByIdQueryOptions, customersQueryOptions } from '@/vite/admin/customers/api'
import type { CustomerSort } from '@kuruma/shared/types/customer'
import { useQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslations } from 'use-intl'

// Must match the API's default sort (routes/customers.ts ALLOWED_SORTS) so the
// loader's prefetch key equals the component's first-page key — a cache hit, no
// refetch flash on mount.
const DEFAULT_SORT: CustomerSort = 'lastBookingAt'
const SEARCH_DEBOUNCE_MS = 300

// Platform-admin customer directory (#1090, epic #1075). The `_admin` parent
// layout already gates on platform-admin membership, so this only owns the data:
// prefetch the first page in the loader, then drive search / cursor pagination /
// detail selection from local state over the existing customers API. The view is
// pure (FC/IS) — all I/O (queries) and cursor/selection state live here.
export const Route = createFileRoute('/$locale/_admin/admin/customers')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(customersQueryOptions({ sort: DEFAULT_SORT })),
  pendingComponent: PageSkeleton,
  errorComponent: CustomersError,
  component: CustomersRoute,
})

function CustomersRoute() {
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<CustomerSort>(DEFAULT_SORT)
  // Stack of cursors for the pages visited; the last element is the current
  // page's cursor (null = first page). Push on Next, pop on Previous.
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Debounce keystrokes so each one doesn't fire a request, and reset to page 1
  // whenever the query changes (a stale cursor is meaningless for a new search).
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput)
      setCursorStack([null])
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  const currentCursor = cursorStack.at(-1) ?? null
  const listQuery = useQuery(
    customersQueryOptions({
      search: debouncedSearch.trim() || undefined,
      sort,
      cursor: currentCursor || undefined,
    }),
  )
  const detailQuery = useQuery(customerByIdQueryOptions(selectedId))

  const nextCursor = listQuery.data?.nextCursor ?? null

  return (
    <CustomersView
      customers={listQuery.data?.data ?? []}
      search={searchInput}
      onSearchChange={setSearchInput}
      sort={sort}
      onSortChange={(next) => {
        setSort(next)
        setCursorStack([null])
      }}
      onSelectCustomer={setSelectedId}
      selectedCustomer={detailQuery.data ?? null}
      isDetailOpen={selectedId !== null}
      isDetailLoading={detailQuery.isLoading}
      onCloseDetail={() => setSelectedId(null)}
      canPrev={cursorStack.length > 1}
      canNext={nextCursor !== null}
      onPrevPage={() => setCursorStack((stack) => stack.slice(0, -1))}
      onNextPage={() => {
        if (nextCursor) setCursorStack((stack) => [...stack, nextCursor])
      }}
    />
  )
}

function CustomersError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.customers')
  return <RouteRetryError message={t('loadError')} retryLabel={t('retry')} />
}
