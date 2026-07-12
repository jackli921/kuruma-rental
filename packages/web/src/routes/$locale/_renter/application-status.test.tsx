import { myApplicationQueryOptions } from '@/vite/operator-registration/api'
import type { MyApplication } from '@/vite/operator-registration/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { ApplicationStatusPage } from './application-status'

// Router <Link> is mocked to a plain anchor that resolves `to` + `params` into a
// concrete href so link destinations are assertable without a real router.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
  }: { to: string; params?: Record<string, string>; children: ReactNode }) => {
    const href = Object.entries(params ?? {}).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to)
    return <a href={href}>{children}</a>
  },
  createFileRoute: () => () => ({}),
}))

const LOCALE = 'en'

function renderPage(application: MyApplication | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Seed the query cache so useQuery returns synchronously without a network hit.
  qc.setQueryData(myApplicationQueryOptions().queryKey, application)

  return render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale={LOCALE} messages={en}>
        <ApplicationStatusPage locale={LOCALE} />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

const M = en.operator.applicationStatus

describe('ApplicationStatusPage', () => {
  it('renders an apply-now CTA linking to the register page when the caller has no application', () => {
    renderPage(null)
    const link = screen.getByRole('link', { name: M.applyNow })
    expect(link.getAttribute('href')).toBe('/en/business/register')
  })

  it('renders "under review" copy for a PENDING application', () => {
    renderPage({
      id: 'app_1',
      status: 'PENDING',
      businessName: 'Acme Cars',
      operatorId: null,
      rejectionReason: null,
    })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(M.pendingTitle)
    expect(screen.getByText(M.pendingBody)).toBeTruthy()
    // No portal link for PENDING
    expect(screen.queryByRole('link', { name: M.goToPortal })).toBeNull()
  })

  it('renders a "go to portal" link targeting /$locale/dashboard for an APPROVED application', () => {
    renderPage({
      id: 'app_2',
      status: 'APPROVED',
      businessName: 'Acme Cars',
      operatorId: 'op_abc',
      rejectionReason: null,
    })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(M.approvedTitle)
    const link = screen.getByRole('link', { name: M.goToPortal })
    expect(link.getAttribute('href')).toBe('/en/dashboard')
  })

  it('renders the rejection title and body for a REJECTED application', () => {
    renderPage({
      id: 'app_3',
      status: 'REJECTED',
      businessName: 'Acme Cars',
      operatorId: null,
      rejectionReason: null,
    })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(M.rejectedTitle)
    expect(screen.getByText(M.rejectedBody)).toBeTruthy()
  })

  it('renders the rejection reason when provided for a REJECTED application', () => {
    renderPage({
      id: 'app_4',
      status: 'REJECTED',
      businessName: 'Acme Cars',
      operatorId: null,
      rejectionReason: 'Incomplete documentation',
    })
    expect(screen.getByText(/Incomplete documentation/)).toBeTruthy()
  })

  it('does not render a rejection reason paragraph when rejectionReason is null', () => {
    renderPage({
      id: 'app_5',
      status: 'REJECTED',
      businessName: 'Acme Cars',
      operatorId: null,
      rejectionReason: null,
    })
    // "Reason:" prefix should not appear when reason is null
    expect(screen.queryByText(/^Reason:/)).toBeNull()
  })
})
