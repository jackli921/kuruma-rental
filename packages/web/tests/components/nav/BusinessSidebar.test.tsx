import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockPathname = '/manage/vehicles'

vi.mock('@/i18n/routing', () => ({
  Link: ({
    href,
    children,
    className,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => mockPathname,
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      dashboard: 'Dashboard',
      bookings: 'Bookings',
      fleet: 'Fleet',
      customers: 'Customers',
      messages: 'Messages',
    }
    return messages[key] ?? key
  },
}))

vi.mock('@/components/providers/LayoutPreferenceProvider', () => ({
  useLayoutPreference: () => ({ preference: 'sidebar', toggle: () => {} }),
}))

import { BusinessSidebar } from '@/components/nav/BusinessSidebar'

describe('BusinessSidebar', () => {
  beforeEach(() => {
    mockPathname = '/manage/vehicles'
  })

  afterEach(() => {
    cleanup()
  })

  it('renders all sidebar items with labels', () => {
    render(<BusinessSidebar />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Bookings')).toBeInTheDocument()
    expect(screen.getByText('Fleet')).toBeInTheDocument()
    expect(screen.getByText('Customers')).toBeInTheDocument()
    expect(screen.getByText('Messages')).toBeInTheDocument()
  })

  it('emits a static className string for every link (no conditional active-state classes in the string)', () => {
    // Regression for #25: the original implementation composed className via
    // `cn('base', isActive ? 'activeClasses' : 'inactiveClasses')`. That
    // produced two different classNames depending on `isActive`, and the
    // active/inactive branch drove a server/client hydration mismatch when
    // `usePathname()` returned a subtly different value across render passes.
    //
    // The fix: render a single static className string on every link and
    // express the active state via an `aria-current` attribute instead. CSS
    // (`aria-[current=page]:*` utilities) handles the visual styling.
    render(<BusinessSidebar />)
    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)

    const classNames = links.map((link) => link.getAttribute('class'))
    // Every link must share the exact same className string.
    const unique = new Set(classNames)
    expect(unique.size).toBe(1)
  })

  it('marks the current route with aria-current="page"', () => {
    mockPathname = '/manage/vehicles'
    render(<BusinessSidebar />)

    const fleetLink = screen.getByRole('link', { name: /Fleet/i })
    expect(fleetLink).toHaveAttribute('aria-current', 'page')

    // Siblings must NOT be marked current.
    const dashboardLink = screen.getByRole('link', { name: /Dashboard/i })
    expect(dashboardLink).not.toHaveAttribute('aria-current')
  })

  it('matches nested routes (e.g. /manage/bookings/123 highlights Bookings)', () => {
    mockPathname = '/manage/bookings/abc-123'
    render(<BusinessSidebar />)

    const bookingsLink = screen.getByRole('link', { name: /Bookings/i })
    expect(bookingsLink).toHaveAttribute('aria-current', 'page')
  })

  it('renders deterministically across repeated renders (hydration-safety smoke test)', () => {
    mockPathname = '/manage/vehicles'

    const { container: c1, unmount: u1 } = render(<BusinessSidebar />)
    const html1 = c1.innerHTML
    u1()

    const { container: c2, unmount: u2 } = render(<BusinessSidebar />)
    const html2 = c2.innerHTML
    u2()

    expect(html1).toBe(html2)
  })
})
