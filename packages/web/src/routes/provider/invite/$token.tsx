import { detectBrowserLocale } from '@/vite/i18n/detectBrowserLocale'
import { createFileRoute, redirect } from '@tanstack/react-router'

// The API mints invite links locale-free (`/provider/invite/<token>`) — it can't
// know the recipient's locale. This unprefixed route catches the cold email click
// and redirects to the localized acceptance page; without it the 3-segment URL
// never matches the 4-segment `/$locale/provider/invite/$token` and 404s. (#521 P1)
export const Route = createFileRoute('/provider/invite/$token')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/$locale/provider/invite/$token',
      params: { locale: detectBrowserLocale(), token: params.token },
    })
  },
})
