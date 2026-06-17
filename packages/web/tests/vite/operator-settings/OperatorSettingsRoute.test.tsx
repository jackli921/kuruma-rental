import { OperatorSettingsRoute } from '@/routes/$locale/_business/manage/settings'
import { type OperatorProfile, operatorProfileQueryKey } from '@/vite/operator-settings/api'
import type { Session } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import enMessages from '../../../messages/en.json'

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

  it('shows a not-applicable notice (no form) for a bypass role with no operatorId', () => {
    renderRoute(bypassSession)
    expect(screen.getByText(en.noOperatorContext)).toBeInTheDocument()
    expect(screen.queryByLabelText(en.form.name)).not.toBeInTheDocument()
  })
})
