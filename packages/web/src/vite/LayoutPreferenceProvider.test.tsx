import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { LayoutPreferenceProvider, useLayoutPreference } from './LayoutPreferenceProvider'

const STORAGE_KEY = 'kuruma-layout-preference'

// Records every preference value the consumer renders, in commit order, so a test
// can assert the FIRST committed render — not just the settled value after effects.
function renderSeenPreferences(): string[] {
  const seen: string[] = []
  function Probe(): null {
    seen.push(useLayoutPreference().preference)
    return null
  }
  render(
    <LayoutPreferenceProvider>
      <Probe />
    </LayoutPreferenceProvider>,
  )
  return seen
}

describe('LayoutPreferenceProvider', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('reads a stored "topnav" on the very first render — no default-sidebar flash', () => {
    localStorage.setItem(STORAGE_KEY, 'topnav')
    const seen = renderSeenPreferences()
    expect(seen[0]).toBe('topnav')
    expect(seen).not.toContain('sidebar')
  })

  it('defaults to the sidebar preference when nothing is stored', () => {
    const seen = renderSeenPreferences()
    expect(seen[0]).toBe('sidebar')
  })

  it('toggle flips the preference and persists the new value to localStorage', () => {
    function Toggler() {
      const { preference, toggle } = useLayoutPreference()
      return (
        <button type="button" onClick={toggle}>
          {preference}
        </button>
      )
    }
    render(
      <LayoutPreferenceProvider>
        <Toggler />
      </LayoutPreferenceProvider>,
    )
    const button = screen.getByRole('button')
    expect(button.textContent).toBe('sidebar')

    fireEvent.click(button)

    expect(button.textContent).toBe('topnav')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('topnav')
  })
})
