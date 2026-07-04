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

  describe('create mode — self-authored (#1437)', () => {
    it('shows a template/custom toggle, defaulting to the template picker', () => {
      render(<AddOnForm mode="create" templates={templates} onSubmit={vi.fn()} />)
      expect(screen.getByRole('radio', { name: 'form.identityTemplate' })).toBeChecked()
      expect(screen.getByRole('radio', { name: 'form.identityCustom' })).not.toBeChecked()
      expect(screen.getByLabelText('form.template')).toBeInTheDocument()
    })

    it('switching to custom reveals the multi-locale name fields and hides the picker', async () => {
      const user = userEvent.setup()
      render(<AddOnForm mode="create" templates={templates} onSubmit={vi.fn()} />)

      await user.click(screen.getByRole('radio', { name: 'form.identityCustom' }))

      expect(screen.getByLabelText('form.nameEn')).toBeInTheDocument()
      expect(screen.getByLabelText('form.nameJa')).toBeInTheDocument()
      expect(screen.getByLabelText('form.nameZh')).toBeInTheDocument()
      expect(screen.queryByLabelText('form.template')).not.toBeInTheDocument()
    })

    it('submits a custom item with identityMode custom and the three name slots', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()
      render(<AddOnForm mode="create" templates={templates} onSubmit={onSubmit} />)

      await user.click(screen.getByRole('radio', { name: 'form.identityCustom' }))
      await user.type(screen.getByLabelText('form.nameEn'), 'GPS unit')
      await user.type(screen.getByLabelText('form.nameJa'), 'GPS ユニット')
      await user.clear(screen.getByLabelText('form.price'))
      await user.type(screen.getByLabelText('form.price'), '1500')
      await user.click(screen.getByRole('button', { name: 'form.save' }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0]).toMatchObject({
        identityMode: 'custom',
        nameEn: 'GPS unit',
        nameJa: 'GPS ユニット',
        nameZh: '',
        priceJpy: 1500,
      })
    })

    it('blocks a custom submit when the English name is empty', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()
      render(<AddOnForm mode="create" templates={templates} onSubmit={onSubmit} />)

      await user.click(screen.getByRole('radio', { name: 'form.identityCustom' }))
      await user.type(screen.getByLabelText('form.nameJa'), 'ジャパン限定')
      await user.click(screen.getByRole('button', { name: 'form.save' }))

      await waitFor(() => expect(screen.getByText('Enter an English name')).toBeInTheDocument())
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  describe('edit mode — self-authored (#1437)', () => {
    it('shows editable name fields (no picker) for a self-authored row', () => {
      render(
        <AddOnForm
          mode="edit"
          editIdentity="custom"
          onSubmit={vi.fn()}
          defaultValues={{
            identityMode: 'custom',
            nameEn: 'GPS unit',
            nameJa: 'GPS ユニット',
            priceJpy: 1500,
          }}
        />,
      )
      expect(screen.getByLabelText('form.nameEn')).toHaveValue('GPS unit')
      expect(screen.getByLabelText('form.nameJa')).toHaveValue('GPS ユニット')
      expect(screen.queryByLabelText('form.template')).not.toBeInTheDocument()
    })

    it('submits an edited custom name (D5 — adds a locale later)', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()
      render(
        <AddOnForm
          mode="edit"
          editIdentity="custom"
          onSubmit={onSubmit}
          defaultValues={{ identityMode: 'custom', nameEn: 'GPS unit', priceJpy: 1500 }}
        />,
      )

      await user.type(screen.getByLabelText('form.nameZh'), 'GPS 装置')
      await user.click(screen.getByRole('button', { name: 'form.save' }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0]).toMatchObject({
        identityMode: 'custom',
        nameEn: 'GPS unit',
        nameZh: 'GPS 装置',
      })
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
