import { isInAppBrowser } from '@/lib/in-app-browser'
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

/** Shown on the sign-in / invite screens when the page is loaded inside an
 *  embedded webview (WeChat, LINE, …), where Google OAuth fails with
 *  `disallowed_useragent`. Guides the user to their real browser and offers a
 *  one-tap copy of the current URL to paste into Safari/Chrome (#992). */
export function InAppBrowserNotice() {
  const t = useTranslations('auth')
  const [copied, setCopied] = useState(false)

  if (typeof navigator === 'undefined' || !isInAppBrowser(navigator.userAgent)) {
    return null
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
    } catch {
      // Clipboard blocked in this webview — the link is still on screen to copy by hand.
    }
  }

  return (
    <div
      role="alert"
      className="my-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <div className="flex gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="space-y-2">
          <p className="font-medium">{t('inAppBrowser.title')}</p>
          <p className="text-amber-800 dark:text-amber-200/90">{t('inAppBrowser.body')}</p>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="font-medium underline underline-offset-2 hover:no-underline"
          >
            {copied ? t('inAppBrowser.copied') : t('inAppBrowser.copyLink')}
          </button>
        </div>
      </div>
    </div>
  )
}
