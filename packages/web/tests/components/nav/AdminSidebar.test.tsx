import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockPathname = '/admin'

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
      'nav.overview': 'Overview',
      'nav.revenue': 'Partner Revenue',
    }
    return messages[key] ?? key
  },
}))

import { AdminSidebar } from '@/components/nav/AdminSidebar'

describe('AdminSidebar', () => {
  beforeEach(() => {
    mockPathname = '/admin'
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the overview and revenue nav items with labels', () => {
    render(<AdminSidebar />)
    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByText('Partner Revenue')).toBeInTheDocument()
  })

  it('points the Partner Revenue link at /admin/revenue', () => {
    render(<AdminSidebar />)
    const revenueLink = screen.getByRole('link', { name: /partner revenue/i })
    expect(revenueLink).toHaveAttribute('href', expect.stringContaining('/admin/revenue'))
  })

  it('emits a static className string for every link (no conditional active-state classes)', () => {
    // #25 hydration guard: active state must be carried by aria-current, not a
    // divergent className branch, so every link shares one className string.
    render(<AdminSidebar />)
    const links = screen.getAllByRole('link')
    expect(links.length).toBe(2)

    const unique = new Set(links.map((link) => link.getAttribute('class')))
    expect(unique.size).toBe(1)
  })

  it('marks the current route with aria-current="page" and not its siblings', () => {
    mockPathname = '/admin/revenue'
    render(<AdminSidebar />)

    const revenueLink = screen.getByRole('link', { name: /partner revenue/i })
    expect(revenueLink).toHaveAttribute('aria-current', 'page')

    const overviewLink = screen.getByRole('link', { name: /overview/i })
    expect(overviewLink).not.toHaveAttribute('aria-current')
  })

  it('renders deterministically across repeated renders (hydration-safety smoke test)', () => {
    mockPathname = '/admin'

    const { container: c1, unmount: u1 } = render(<AdminSidebar />)
    const html1 = c1.innerHTML
    u1()

    const { container: c2, unmount: u2 } = render(<AdminSidebar />)
    const html2 = c2.innerHTML
    u2()

    expect(html1).toBe(html2)
  })
})
