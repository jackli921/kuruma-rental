import type { TemplateAdminRow } from '@kuruma/shared/types/template-admin'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../../messages/en.json'
import { TemplateLibraryView } from './TemplateLibraryView'

const ARCHIVED_ADD_ON: TemplateAdminRow = {
  id: 'a1',
  key: 'baby-seat',
  name: { en: 'Baby seat' },
  description: null,
  status: 'ARCHIVED',
}
const ACTIVE_INSURANCE: TemplateAdminRow = {
  id: 'i1',
  key: 'normal',
  name: { en: 'Normal', ja: 'ノーマル', zh: '标准' },
  description: null,
  status: 'ACTIVE',
}

function renderView(props?: Partial<Parameters<typeof TemplateLibraryView>[0]>) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <TemplateLibraryView
        addOns={props?.addOns ?? [ARCHIVED_ADD_ON]}
        insurance={props?.insurance ?? [ACTIVE_INSURANCE]}
      />
    </IntlProvider>,
  )
}

describe('TemplateLibraryView', () => {
  it('shows the add-ons catalog first with name, key and status', () => {
    renderView()
    const row = screen.getByText('Baby seat').closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('baby-seat')).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText('Archived')).toBeInTheDocument()
    // The insurance catalog is behind its tab, so its row is not rendered yet.
    expect(screen.queryByText('Normal')).not.toBeInTheDocument()
  })

  it('flags missing locales on an en-only row and marks present ones', () => {
    renderView()
    const row = screen.getByText('Baby seat').closest('tr') as HTMLElement
    // en present -> primary chip; ja/zh absent -> dashed outline chip.
    expect(within(row).getByText('en').className).toContain('bg-primary')
    expect(within(row).getByText('ja').className).toContain('border-dashed')
    expect(within(row).getByText('zh').className).toContain('border-dashed')
  })

  it('switches to the insurance catalog when its tab is clicked', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Insurance (1)' }))
    const row = screen.getByText('Normal').closest('tr') as HTMLElement
    expect(within(row).getByText('Active')).toBeInTheDocument()
    // A fully-translated row marks every locale present (no dashed chips).
    expect(within(row).getByText('ja').className).toContain('bg-primary')
    expect(screen.queryByText('Baby seat')).not.toBeInTheDocument()
  })

  it('renders an empty message when a catalog has no templates', () => {
    renderView({ addOns: [] })
    expect(screen.getByText('No templates in this catalog yet.')).toBeInTheDocument()
  })
})
