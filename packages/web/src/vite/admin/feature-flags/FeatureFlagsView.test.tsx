import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { type FeatureFlagRow, FeatureFlagsView } from './FeatureFlagsView'

function sampleRows(): FeatureFlagRow[] {
  return [
    { key: 'MULTI_CURRENCY', label: 'Multi-currency display', effective: true, overridden: true },
    { key: 'REVIEWS', label: 'Reviews & ratings', effective: false, overridden: false },
  ]
}

function renderView(
  props: Partial<Parameters<typeof FeatureFlagsView>[0]> & {
    onToggle?: (key: string, enabled: boolean) => void
  } = {},
) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <FeatureFlagsView
        rows={props.rows ?? sampleRows()}
        pendingKey={props.pendingKey ?? null}
        onToggle={props.onToggle ?? vi.fn()}
      />
    </IntlProvider>,
  )
}

describe('FeatureFlagsView', () => {
  it('renders one switch per flag reflecting its effective state', () => {
    renderView()
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.getByRole('switch', { name: 'Toggle Multi-currency display' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Toggle Reviews & ratings' })).not.toBeChecked()
  })

  it('distinguishes an overridden flag from one following the build default', () => {
    renderView()
    expect(screen.getByText('Overridden')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
  })

  it('toggling a flag calls onToggle with the negated value', () => {
    const onToggle = vi.fn()
    renderView({ onToggle })
    // REVIEWS is currently OFF -> clicking requests ON.
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Reviews & ratings' }))
    expect(onToggle).toHaveBeenCalledWith('REVIEWS', true)
  })

  it('does not fire onToggle for the flag whose write is in flight', () => {
    const onToggle = vi.fn()
    renderView({ onToggle, pendingKey: 'MULTI_CURRENCY' })
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Multi-currency display' }))
    expect(onToggle).not.toHaveBeenCalled()
  })
})
