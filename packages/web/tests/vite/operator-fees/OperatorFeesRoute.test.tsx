import { OperatorFeesRoute } from '@/routes/$locale/_business/manage/fees'
import type { OperatorScope } from '@/vite/operator-context'
import type { Session } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// P1b junction under test: fees.tsx forces a picker-admin to read-only via
// `feesScope = { ...scope, canWrite: isOperatorSession(session) }`. We drive a
// GENERIC scope that already grants `canWrite: true` (as the picker would for a
// chosen tenant) and prove the route's session-derived override still strips the
// Add affordance for a PLATFORM_ADMIN, while a real operator session keeps it.
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

describe('OperatorFeesRoute P1b read-only override', () => {
  beforeEach(() => {
    useOperatorScopeMock.mockReturnValue(writableScope)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('hides the Add affordance for a PLATFORM_ADMIN even when the scope grants canWrite (override forces read-only)', () => {
    useSessionMock.mockReturnValue({ data: platformAdminSession() })

    renderRoute()

    expect(screen.getByText(en.title)).toBeInTheDocument()
    // The generic scope said canWrite=true; the session-derived override flips it
    // to false because a platform admin is not an operator session. If the route
    // passed `scope` straight through, this Add button would render and fail here.
    expect(screen.queryByRole('button', { name: en.addFee })).not.toBeInTheDocument()
  })

  it('shows the Add affordance for a real operator session (operatorId present)', () => {
    useSessionMock.mockReturnValue({ data: operatorOwnerSession() })

    renderRoute()

    expect(screen.getByRole('button', { name: en.addFee })).toBeInTheDocument()
  })
})
