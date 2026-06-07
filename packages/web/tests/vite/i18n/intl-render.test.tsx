import { render, screen } from '@testing-library/react'
import { IntlProvider, useTranslations } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import ja from '../../../messages/ja.json'
import zh from '../../../messages/zh.json'

function Cancel() {
  const t = useTranslations('common')
  return <span>{t('cancel')}</span>
}

// Guards the spec §10 risk that use-intl renders our next-intl-authored messages
// differently. Asserts the actual localized string per locale (en != ja != zh).
describe('use-intl renders the project messages', () => {
  it.each([
    ['en', en, 'Cancel'],
    ['ja', ja, 'キャンセル'],
    ['zh', zh, '取消'],
  ])('renders common.cancel for %s', (locale, messages, expected) => {
    render(
      <IntlProvider locale={locale} messages={messages}>
        <Cancel />
      </IntlProvider>,
    )
    expect(screen.getByText(expected)).toBeInTheDocument()
  })
})
