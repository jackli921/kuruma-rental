import { createFileRoute } from '@tanstack/react-router'

// Placeholder landing for the 5a build proof. Replaced by the locale-aware
// route tree (`$locale/...`) and real landing port in phases 5b/5d.
export const Route = createFileRoute('/')({
  component: () => <div>Best Car Rental — Vite shell</div>,
})
