import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('use-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { AddOnForm } from '@/vite/operator-add-ons/AddOnForm'

const templates = [
  { id: 't1', key: 'child_seat', resolvedName: 'Child seat' },
  { id: 't2', key: 'etc_card', resolvedName: 'ETC card' },
]

describe('AddOnForm', () => {
  afterEach(() => cleanup())

  describe('create mode', () => {
    it('renders the template picker, description and price fields', () => {
      render(<AddOnForm mode="create" templates={templates} onSubmit={vi.fn()} />)
      expect(screen.getByLabelText('form.template')).toBeInTheDocument()
      expect(screen.getByLabelText('form.description')).toBeInTheDocument()
      expect(screen.getByLabelText('form.price')).toBeInTheDocument()
    })

    it('lists each template as an option in the picker', () => {
      render(<AddOnForm mode="create" templates={templates} onSubmit={vi.fn()} />)
      expect(screen.getByRole('option', { name: 'Child seat' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'ETC card' })).toBeInTheDocument()
    })

    it('submits the picked templateId with priceJpy as a number (valueAsNumber coercion)', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()
      render(<AddOnForm mode="create" templates={templates} onSubmit={onSubmit} />)

      await user.selectOptions(screen.getByLabelText('form.template'), 't1')
      await user.clear(screen.getByLabelText('form.price'))
      await user.type(screen.getByLabelText('form.price'), '1500')
      await user.click(screen.getByRole('button', { name: 'form.save' }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      const data = onSubmit.mock.calls[0][0]
      expect(data).toMatchObject({ templateId: 't1', priceJpy: 1500, description: '' })
      // Mutation-resistant: a string '1500' would pass toMatchObject loosely.
      expect(typeof data.priceJpy).toBe('number')
    })

    it('blocks submit and surfaces the error when no template is picked', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()
      render(<AddOnForm mode="create" templates={templates} onSubmit={onSubmit} />)

      await user.clear(screen.getByLabelText('form.price'))
      await user.type(screen.getByLabelText('form.price'), '1500')
      await user.click(screen.getByRole('button', { name: 'form.save' }))

      await waitFor(() => expect(screen.getByText('Select an add-on template')).toBeInTheDocument())
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('blocks submit for a negative price', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()
      render(<AddOnForm mode="create" templates={templates} onSubmit={onSubmit} />)

      await user.selectOptions(screen.getByLabelText('form.template'), 't1')
      await user.clear(screen.getByLabelText('form.price'))
      await user.type(screen.getByLabelText('form.price'), '-1')
      await user.click(screen.getByRole('button', { name: 'form.save' }))

      await waitFor(() => expect(screen.getByText('Price cannot be negative')).toBeInTheDocument())
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  describe('edit mode', () => {
    it('shows the template name read-only (no picker) and pre-fills price + description', () => {
      render(
        <AddOnForm
          mode="edit"
          templateName="ETC card"
          onSubmit={vi.fn()}
          defaultValues={{ templateId: 't2', priceJpy: 500, description: 'Toll pass' }}
        />,
      )
      expect(screen.getByText('ETC card')).toBeInTheDocument()
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
      expect(screen.getByLabelText('form.description')).toHaveValue('Toll pass')
      expect(screen.getByLabelText('form.price')).toHaveValue(500)
    })

    it('submits price + description without requiring a template pick', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()
      render(
        <AddOnForm
          mode="edit"
          templateName="ETC card"
          onSubmit={onSubmit}
          defaultValues={{ templateId: 't2', priceJpy: 500, description: '' }}
        />,
      )

      await user.clear(screen.getByLabelText('form.price'))
      await user.type(screen.getByLabelText('form.price'), '800')
      await user.type(screen.getByLabelText('form.description'), 'Toll pass')
      await user.click(screen.getByRole('button', { name: 'form.save' }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0]).toMatchObject({ priceJpy: 800, description: 'Toll pass' })
    })
  })
})
