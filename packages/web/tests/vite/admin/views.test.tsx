import { formatJpy } from '@/lib/format'
import { AdminHomeView } from '@/vite/admin/AdminHomeView'
import { RevenueView } from '@/vite/admin/RevenueView'
import type { AdminRevenueResponse } from '@kuruma/shared/types/admin-revenue'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const noop = () => {}

const renderView = (ui: ReactNode) =>
  render(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  )

// Distinct figures across every cell so getByText stays unambiguous (each money
// value appears in exactly one place; month labels appear once per partner table).
const REPORT: AdminRevenueResponse = {
  availableMonths: ['2026-03', '2026-02'],
  selectedMonth: null,
  partners: [
    {
      operatorId: 'op-a',
      operatorName: 'Best Car Rental',
      operatorSlug: 'best-car',
      grossJpy: 100000,
      platformFeeJpy: 4000,
      netToPartnerJpy: 96000,
      paymentCount: 5,
      months: [
        {
          month: '2026-03',
          grossJpy: 60000,
          platformFeeJpy: 2400,
          netToPartnerJpy: 57600,
          paymentCount: 3,
        },
        {
          month: '2026-02',
          grossJpy: 40000,
          platformFeeJpy: 1600,
          netToPartnerJpy: 38400,
          paymentCount: 2,
        },
      ],
    },
    {
      operatorId: 'op-b',
      operatorName: 'Osaka Drive',
      operatorSlug: 'osaka-drive',
      grossJpy: 50000,
      platformFeeJpy: 2000,
      netToPartnerJpy: 48000,
      paymentCount: 2,
      months: [
        {
          month: '2026-03',
          grossJpy: 30000,
          platformFeeJpy: 1200,
          netToPartnerJpy: 28800,
          paymentCount: 1,
        },
        {
          month: '2026-02',
          grossJpy: 20000,
          platformFeeJpy: 800,
          netToPartnerJpy: 19200,
          paymentCount: 1,
        },
      ],
    },
  ],
  totals: { grossJpy: 150000, platformFeeJpy: 6000, netToPartnerJpy: 144000, paymentCount: 7 },
}

const EMPTY_REPORT: AdminRevenueResponse = {
  availableMonths: [],
  selectedMonth: null,
  partners: [],
  totals: { grossJpy: 0, platformFeeJpy: 0, netToPartnerJpy: 0, paymentCount: 0 },
}

describe('AdminHomeView', () => {
  it('shows the platform admin title + subtitle', () => {
    renderView(<AdminHomeView />)
    expect(screen.getByRole('heading', { name: 'Platform Admin' })).toBeInTheDocument()
    expect(screen.getByText('Platform operations')).toBeInTheDocument()
  })
})

describe('RevenueView', () => {
  it('renders the title and the 4% commission model copy', () => {
    renderView(<RevenueView report={REPORT} onSelectMonth={noop} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Partner Revenue' })).toBeInTheDocument()
    expect(screen.getByText(en.admin.revenue.model)).toBeInTheDocument()
  })

  it('sums gross / platform fee / net payable across all partners', () => {
    renderView(<RevenueView report={REPORT} onSelectMonth={noop} />)
    expect(screen.getByText(formatJpy(150000))).toBeInTheDocument()
    expect(screen.getByText(formatJpy(6000))).toBeInTheDocument()
    expect(screen.getByText(formatJpy(144000))).toBeInTheDocument()
  })

  it('lists each partner with its monthly breakdown and subtotal', () => {
    renderView(<RevenueView report={REPORT} onSelectMonth={noop} />)
    expect(screen.getByText('Best Car Rental')).toBeInTheDocument()
    expect(screen.getByText('Osaka Drive')).toBeInTheDocument()
    // Best Car Rental's March gross + its net-payable subtotal (tfoot Total row).
    expect(screen.getByText(formatJpy(60000))).toBeInTheDocument()
    expect(screen.getByText(formatJpy(96000))).toBeInTheDocument()
    // The same JST month heads a row in each partner's table (rowheader scope
    // excludes the month-picker <option> with the same text).
    expect(screen.getAllByRole('rowheader', { name: '2026-03' })).toHaveLength(2)
  })

  it('shows the empty state and no partner tables when nothing is recorded', () => {
    renderView(<RevenueView report={EMPTY_REPORT} onSelectMonth={noop} />)
    expect(screen.getByText(en.admin.revenue.empty)).toBeInTheDocument()
    expect(screen.queryByText('Best Car Rental')).not.toBeInTheDocument()
    // Title/model stay so the page reads as deliberately empty, not broken.
    expect(screen.getByRole('heading', { level: 1, name: 'Partner Revenue' })).toBeInTheDocument()
  })

  it('renders the month picker with an all-months option and every payout month', () => {
    renderView(<RevenueView report={REPORT} onSelectMonth={noop} />)
    const picker = screen.getByLabelText(en.admin.revenue.monthFilterLabel)
    const options = [...picker.querySelectorAll('option')].map((o) => o.textContent)
    expect(options).toEqual([en.admin.revenue.allMonths, '2026-03', '2026-02'])
  })

  it('calls onSelectMonth with the chosen month, and null when All months is picked', async () => {
    const user = userEvent.setup()
    const onSelectMonth = vi.fn()
    renderView(
      <RevenueView
        report={{ ...REPORT, selectedMonth: '2026-03' }}
        onSelectMonth={onSelectMonth}
      />,
    )
    const picker = screen.getByLabelText(en.admin.revenue.monthFilterLabel)
    await user.selectOptions(picker, '2026-02')
    expect(onSelectMonth).toHaveBeenLastCalledWith('2026-02')
    await user.selectOptions(picker, en.admin.revenue.allMonths)
    expect(onSelectMonth).toHaveBeenLastCalledWith(null)
  })

  it('hides the picker when there are no payout months', () => {
    renderView(<RevenueView report={EMPTY_REPORT} onSelectMonth={noop} />)
    expect(screen.queryByLabelText(en.admin.revenue.monthFilterLabel)).not.toBeInTheDocument()
  })
})
