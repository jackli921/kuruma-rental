import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The revenue placeholder is a thin async server component that pulls copy from
// the `admin` namespace. Mock the request-scoped translator so we can render it
// in jsdom and assert the money-flow spec is actually wired into the page.
const ADMIN_COPY: Record<string, string> = {
  'revenue.title': 'Partner Revenue',
  'revenue.subtitle': 'Monthly payout per partner',
  'revenue.comingSoon': 'Coming soon — depends on payment events (#461)',
  'revenue.model':
    'Renter pays the listed price; the platform keeps 4%; remittance = paid − 4%, aggregated per business for monthly payout.',
}

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => ADMIN_COPY[key] ?? key,
}))

import RevenuePage from '@/app/[locale]/(admin)/admin/revenue/page'

describe('Admin Partner Revenue page', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders a coming-soon placeholder gated on payment events', async () => {
    render(await RevenuePage())
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
  })

  it('documents the 4% money-flow model so the placeholder is a useful spec', async () => {
    render(await RevenuePage())
    expect(screen.getByText(/4%/)).toBeInTheDocument()
  })
})
