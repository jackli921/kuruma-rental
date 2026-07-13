import { ComboRow } from '@/vite/operator-combo-deals/ComboRow'
import type { ClassRatePlanData } from '@/vite/operator-combo-deals/api'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

function withIntl(node: ReactNode) {
  return render(
    <IntlProvider locale="en" messages={en}>
      {node}
    </IntlProvider>,
  )
}

const DEAL: ClassRatePlanData = {
  id: 'crp_1',
  operatorId: 'op_1',
  classId: 'cls_kei',
  pickupLocationId: 'loc_namba',
  dayRateJpy: 6000,
  isActive: true,
  label: 'Kei Class Deal — Namba',
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
}

const noop = vi.fn()

describe('ComboRow', () => {
  it('renders the resolved class, location, label, yen rate, and an Active badge', () => {
    withIntl(
      <ComboRow
        deal={DEAL}
        className="Kei"
        locationName="Namba"
        canWrite
        onEdit={noop}
        onToggle={noop}
        onRemove={noop}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Kei' })).toBeInTheDocument()
    expect(screen.getByText('Namba')).toBeInTheDocument()
    expect(screen.getByText('Kei Class Deal — Namba')).toBeInTheDocument()
    // formatJpy renders whole-yen with no minor unit. The yen glyph varies by the
    // JS runtime's ICU, so assert on the grouped digits, which are stable, plus the
    // localized "per day" unit label.
    expect(
      screen.getByText((_, node) => node?.textContent?.includes('6,000') ?? false, {
        selector: 'span',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/per day/)).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText('Inactive')).toBeNull()
  })

  it('shows the Inactive badge and a Deactivate control flips to Activate when inactive', () => {
    withIntl(
      <ComboRow
        deal={{ ...DEAL, isActive: false }}
        className="Kei"
        locationName="Namba"
        canWrite
        onEdit={noop}
        onToggle={noop}
        onRemove={noop}
      />,
    )

    expect(screen.getByText('Inactive')).toBeInTheDocument()
    // Inactive deal -> the toggle offers to *activate* it.
    expect(screen.getByRole('button', { name: 'Activate deal' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deactivate deal' })).toBeNull()
  })

  it('falls back to "Unknown class"/"Unknown location" when names cannot be resolved', () => {
    withIntl(
      <ComboRow
        deal={DEAL}
        className={null}
        locationName={null}
        canWrite
        onEdit={noop}
        onToggle={noop}
        onRemove={noop}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Unknown class' })).toBeInTheDocument()
    expect(screen.getByText('Unknown location')).toBeInTheDocument()
  })

  it('hides all write controls when the viewer cannot write (read-only all-mode)', () => {
    withIntl(
      <ComboRow
        deal={DEAL}
        className="Kei"
        locationName="Namba"
        canWrite={false}
        onEdit={noop}
        onToggle={noop}
        onRemove={noop}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Edit deal' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete deal' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Deactivate deal' })).toBeNull()
  })
})
