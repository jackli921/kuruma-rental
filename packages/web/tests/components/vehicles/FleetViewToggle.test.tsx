// The row/grid view toggle that lives in the top bar of the owner-facing
// fleet list (#52). Kept as a small dedicated component so its state
// management (localStorage-backed) and presentation can be tested in
// isolation from VehicleList, which is mostly QueryClient glue.

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      'fleet.rowView': 'Row view',
      'fleet.gridView': 'Grid view',
    }
    return messages[key] ?? key
  },
}))

import { FleetViewToggle, type FleetViewMode } from '@/components/vehicles/FleetViewToggle'

describe('FleetViewToggle', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders both view options with accessible labels', () => {
    render(<FleetViewToggle value="row" onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Row view' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grid view' })).toBeInTheDocument()
  })

  it('marks the active mode with aria-pressed=true and the inactive one false', () => {
    render(<FleetViewToggle value="row" onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Row view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('emits onChange("grid") when the Grid view button is clicked while row is active', async () => {
    const onChange = vi.fn<[FleetViewMode], void>()
    render(<FleetViewToggle value="row" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Grid view' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('grid')
  })

  it('emits onChange("row") when the Row view button is clicked while grid is active', async () => {
    const onChange = vi.fn<[FleetViewMode], void>()
    render(<FleetViewToggle value="grid" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Row view' }))

    expect(onChange).toHaveBeenCalledWith('row')
  })

  it('does not emit onChange when the already-active button is clicked', async () => {
    const onChange = vi.fn<[FleetViewMode], void>()
    render(<FleetViewToggle value="row" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Row view' }))

    expect(onChange).not.toHaveBeenCalled()
  })
})

// localStorage-backed persistence is a separate concern from the pure
// toggle UI. It lives in a hook tested here. We write a couple of
// behavior-level tests that mutate window.localStorage directly and
// assert the hook's state.
import { renderHook, act } from '@testing-library/react'
import { useFleetViewMode } from '@/components/vehicles/FleetViewToggle'

describe('useFleetViewMode', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults to "row" when nothing is persisted', () => {
    const { result } = renderHook(() => useFleetViewMode())
    expect(result.current[0]).toBe('row')
  })

  it('reads the persisted value on mount', () => {
    window.localStorage.setItem('kuruma-fleet-view-mode', 'grid')
    const { result } = renderHook(() => useFleetViewMode())
    expect(result.current[0]).toBe('grid')
  })

  it('persists the new value when the setter is called', () => {
    const { result } = renderHook(() => useFleetViewMode())
    act(() => {
      result.current[1]('grid')
    })
    expect(result.current[0]).toBe('grid')
    expect(window.localStorage.getItem('kuruma-fleet-view-mode')).toBe('grid')
  })

  it('ignores garbage persisted values and falls back to "row"', () => {
    window.localStorage.setItem('kuruma-fleet-view-mode', 'wrong')
    const { result } = renderHook(() => useFleetViewMode())
    expect(result.current[0]).toBe('row')
  })
})
