import { OperatorFeesRoute } from '@/routes/$locale/_business/manage/fees'
import type { OperatorScope } from '@/vite/operator-context'
import type { Session } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// #1442 junction under test: fees.tsx no longer forces a picker-admin to
// read-only. It forwards `scope.canWrite` (= `canWriteAsOperator`) straight
// through to the view, so a picker admin who has chosen a tenant writes. We drive
// the scope's `canWrite` directly and prove the route respects it without any
// session-role override — reintroducing the old override would fail these.
const useOperatorScopeMock = vi.fn<() => OperatorScope>()
const useSessionMock = vi.fn<() => { data: Session | null }>()

vi.mock('@/vite/operator-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-context')>()
  return { ...actual, useOperatorScope: () => useOperatorScopeMock() }
})

vi.mock('@/vite/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/session')>()
  return { ...actual, useSession: () => useSessionMock() }
})

// The route's two useSuspenseQuery reads (fees + scoped classes) are I/O the
// junction does not exercise; stub them to empty so the view renders its empty
// state without a query cache round-trip.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useSuspenseQuery: () => ({ data: [] }) }
})

const en = enMessages.business.fees

// A scope that would, on its own, permit writes — the override must be what
// actually decides, not this value.
const writableScope: OperatorScope = {
  pickedOperatorId: undefined,
  canWrite: true,
  showOperator: false,
  operatorNameById: new Map(),
}

function platformAdminSession(): Session {
  return { user: { id: 'u_admin', role: 'PLATFORM_ADMIN' }, csrfToken: 'csrf' }
}

function operatorOwnerSession(): Session {
  return {
    user: { id: 'u_owner', role: 'OPERATOR_OWNER', operatorId: 'op_1' },
    csrfToken: 'csrf',
  }
}

function renderRoute() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={enMessages}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    )
  }
  return render(<OperatorFeesRoute />, { wrapper })
}

describe('OperatorFeesRoute forwards the picker scope (no read-only override)', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows the Add affordance for a PLATFORM_ADMIN when the picked-operator scope grants canWrite', () => {
    // #1442: the route no longer strips writes from a platform admin. A picker
    // admin who has chosen a tenant carries canWrite=true and gets the affordance.
    useOperatorScopeMock.mockReturnValue({ ...writableScope, pickedOperatorId: 'op_9' })
    useSessionMock.mockReturnValue({ data: platformAdminSession() })

    renderRoute()

    expect(screen.getByText(en.title)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.addFee })).toBeInTheDocument()
  })

  it('hides the Add affordance when the scope denies canWrite (all-mode cross-operator reader)', () => {
    // A platform admin with NO picked operator is a read-only cross-tenant reader:
    // canWrite=false, so the write affordances stay hidden.
    useOperatorScopeMock.mockReturnValue({ ...writableScope, canWrite: false })
    useSessionMock.mockReturnValue({ data: platformAdminSession() })

    renderRoute()

    expect(screen.queryByRole('button', { name: en.addFee })).not.toBeInTheDocument()
  })

  it('shows the Add affordance for a real operator session (operatorId present)', () => {
    useOperatorScopeMock.mockReturnValue(writableScope)
    useSessionMock.mockReturnValue({ data: operatorOwnerSession() })

    renderRoute()

    expect(screen.getByRole('button', { name: en.addFee })).toBeInTheDocument()
  })
})
