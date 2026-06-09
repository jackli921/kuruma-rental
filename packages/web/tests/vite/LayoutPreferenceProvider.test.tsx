import { LayoutPreferenceProvider, useLayoutPreference } from '@/vite/LayoutPreferenceProvider'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

const STORAGE_KEY = 'kuruma-layout-preference'

function Harness() {
  const { preference, toggle } = useLayoutPreference()
  return (
    <div>
      <span data-testid="pref">{preference}</span>
      <button type="button" onClick={toggle}>
        toggle
      </button>
    </div>
  )
}

function renderHarness() {
  return render(
    <LayoutPreferenceProvider>
      <Harness />
    </LayoutPreferenceProvider>,
  )
}

describe('LayoutPreferenceProvider', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to the sidebar layout', () => {
    renderHarness()
    expect(screen.getByTestId('pref')).toHaveTextContent('sidebar')
  })

  it('toggles to topnav and persists the choice to localStorage', () => {
    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.getByTestId('pref')).toHaveTextContent('topnav')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('topnav')
  })

  it('restores a previously stored preference on mount', () => {
    localStorage.setItem(STORAGE_KEY, 'topnav')
    renderHarness()
    expect(screen.getByTestId('pref')).toHaveTextContent('topnav')
  })

  it('ignores a corrupt stored value and keeps the default', () => {
    localStorage.setItem(STORAGE_KEY, 'garbage')
    renderHarness()
    expect(screen.getByTestId('pref')).toHaveTextContent('sidebar')
  })
})
