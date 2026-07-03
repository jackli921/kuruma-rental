import type { TemplateAdminRow } from '@kuruma/shared/types/template-admin'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { TemplateEditDialog } from './TemplateEditDialog'
import { updateTemplate } from './api'

// The dialog reads the CSRF token from the session and PATCHes via updateTemplate;
// both are stubbed so the test asserts the wiring (what patch is sent), not I/O.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'csrf_1' } }),
}))
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, updateTemplate: vi.fn() }
})

const ARCHIVED_ADD_ON: TemplateAdminRow = {
  id: 'a1',
  key: 'baby-seat',
  name: { en: 'Baby seat' },
  description: null,
  status: 'ARCHIVED',
}

function renderDialog(over?: { row?: TemplateAdminRow; onOpenChange?: (open: boolean) => void }) {
  const onOpenChange = over?.onOpenChange ?? vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={en}>
        <TemplateEditDialog
          catalog="add-ons"
          row={over?.row ?? ARCHIVED_ADD_ON}
          onOpenChange={onOpenChange}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange }
}

describe('TemplateEditDialog', () => {
  afterEach(() => {
    vi.mocked(updateTemplate).mockReset()
  })

  it('pre-fills the form from the row', () => {
    renderDialog()
    expect(screen.getByLabelText('Name EN')).toHaveValue('Baby seat')
    expect(screen.getByLabelText('Name JA')).toHaveValue('')
  })

  it('translates and promotes in one Save, sending the merged patch with the CSRF token', async () => {
    vi.mocked(updateTemplate).mockResolvedValue({ ...ARCHIVED_ADD_ON, status: 'ACTIVE' })
    const { onOpenChange } = renderDialog()

    fireEvent.change(screen.getByLabelText('Name JA'), { target: { value: 'ベビーシート' } })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ACTIVE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    // TanStack passes a context object as a 2nd arg; assert the variables only.
    expect(vi.mocked(updateTemplate).mock.calls[0]?.[0]).toEqual({
      catalog: 'add-ons',
      id: 'a1',
      patch: {
        name: { en: 'Baby seat', ja: 'ベビーシート' },
        description: null,
        status: 'ACTIVE',
      },
      csrfToken: 'csrf_1',
    })
  })

  it('blocks Save (and never calls the API) while the English name is empty', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('Name EN'), { target: { value: '   ' } })

    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(updateTemplate).not.toHaveBeenCalled()
    expect(screen.getByText('An English name is required.')).toBeInTheDocument()
  })
})
