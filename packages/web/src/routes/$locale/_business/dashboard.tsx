import { createFileRoute } from '@tanstack/react-router'

// Placeholder so the business guard layout has a reachable child (`/<locale>/dashboard`).
// Real dashboard ports in the business-portal slice.
export const Route = createFileRoute('/$locale/_business/dashboard')({
  component: () => <main>Dashboard (port pending)</main>,
})
