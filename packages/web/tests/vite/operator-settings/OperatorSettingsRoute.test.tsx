import { OperatorSettingsRoute } from '@/routes/$locale/_business/manage/settings'
import { type OperatorProfile, operatorProfileQueryKey } from '@/vite/operator-settings/api'
import type { Session } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// The route reads the picked operator from the `_business` search param via
// useOperatorContext, which (in production) calls getRouteApi(...).useSearch().
// These tests render the component without a router, so stub that one read and
// drive the picked id per-test through the hoisted holder. Everything else in the
// barrel (guards-free) is the real module so route-id wiring isn't masked.
const h = vi.hoisted(() => ({ picked: undefined as string | undefined }))
vi.mock('@/vite/operator-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/vite/operator-context')>()),
  useOperatorContext: () => ({ pickedOperatorId: h.picked }),
}))

const en = enMessages.business.settings

const OP_ID = 'op_1'

function profile(): OperatorProfile {
  return {
    id: OP_ID,
    name: 'Acme Cars',
    slug: 'acme-cars',
    preAuthHandoffUrl: 'https://pay.acme/h',
  }
}

const ownerSession: Session = {
  user: { id: 'u', role: 'OPERATOR_OWNER', operatorId: OP_ID, operatorSlug: 'acme-cars' },
  csrfToken: 't',
}
const staffSession: Session = {
  user: { id: 'u', role: 'OPERATOR_STAFF', operatorId: OP_ID, operatorSlug: 'acme-cars' },
  csrfToken: 't',
}
const bypassSession: Session = {
  user: { id: 'u', role: 'PLATFORM_ADMIN' },
  csrfToken: 't',
}
// Legacy STAFF/ADMIN ∈ BUSINESS_ROLES but cannot pick (not PLATFORM_ADMIN) and
// carry no operatorId, so they still hit the terminal noOperatorContext arm.
const legacyStaffSession: Session = {
  user: { id: 'u', role: 'STAFF' },
  csrfToken: 't',
}

// Seed both queries the route reads via useSuspenseQuery so they resolve from
// cache (no fetch, no router). The profile is keyed by operatorId.
function renderRoute(session: Session) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  queryClient.setQueryData(['session'], session)
  queryClient.setQueryData(operatorProfileQueryKey(OP_ID), profile())
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <OperatorSettingsRoute />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('OperatorSettingsRoute (#903)', () => {
  // Reset the picked operator so the owner/staff cases fall back to their own id.
  beforeEach(() => {
    h.picked = undefined
  })

  it('prefills the profile and lets an owner edit the handoff URL', () => {
    renderRoute(ownerSession)
    expect(screen.getByLabelText(en.form.name)).toHaveValue('Acme Cars')
    const handoff = screen.getByLabelText(en.form.handoffUrl)
    expect(handoff).toHaveValue('https://pay.acme/h')
    expect(handoff).not.toBeDisabled()
  })

  it('disables the handoff URL and shows the owner-only note for OPERATOR_STAFF', () => {
    renderRoute(staffSession)
    expect(screen.getByLabelText(en.form.handoffUrl)).toBeDisabled()
    expect(screen.getByText(en.form.handoffOwnerOnly)).toBeInTheDocument()
  })

  it('lets a platform admin who picked an operator edit its profile incl. handoff', () => {
    h.picked = OP_ID // the profile is seeded under OP_ID; admin has no own operatorId
    renderRoute(bypassSession)
    expect(screen.getByLabelText(en.form.name)).toHaveValue('Acme Cars')
    const handoff = screen.getByLabelText(en.form.handoffUrl)
    expect(handoff).not.toBeDisabled() // admin-as-owner (spec §7)
    expect(screen.getByText('Editing settings for Acme Cars')).toBeInTheDocument()
  })

  it('shows the pick-operator prompt (no form) for a platform admin with no pick', () => {
    h.picked = undefined
    renderRoute(bypassSession)
    expect(screen.getByText(en.pickOperatorPrompt)).toBeInTheDocument()
    expect(screen.queryByLabelText(en.form.name)).not.toBeInTheDocument()
  })

  it('shows the terminal no-operator-context notice (no form) for a legacy STAFF session', () => {
    h.picked = undefined
    renderRoute(legacyStaffSession)
    expect(screen.getByText(en.noOperatorContext)).toBeInTheDocument()
    expect(screen.queryByLabelText(en.form.name)).not.toBeInTheDocument()
  })
})
