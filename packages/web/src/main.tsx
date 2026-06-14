import '@/styles/globals.css'
import {
  SentryErrorBoundary,
  captureRouteError,
  initBrowserSentry,
} from '@/lib/observability/sentry'
import { queryClient } from '@/vite/query-client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { routeTree } from './routeTree.gen'

initBrowserSentry(import.meta.env)

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultOnCatch: captureRouteError,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')
if (rootElement && !rootElement.innerHTML) {
  createRoot(rootElement).render(
    <StrictMode>
      <SentryErrorBoundary>
        <RouterProvider router={router} />
      </SentryErrorBoundary>
    </StrictMode>,
  )
}
