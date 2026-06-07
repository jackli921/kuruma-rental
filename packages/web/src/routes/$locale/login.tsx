import { createFileRoute } from '@tanstack/react-router'

// Redirect target for the renter/business guards (#378 §4.3). The real login UI
// (current marketplace `[locale]/(auth)/login`) ports in the auth-page slice.
export const Route = createFileRoute('/$locale/login')({
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } =>
    typeof search.returnTo === 'string' ? { returnTo: search.returnTo } : {},
  component: LoginPlaceholder,
})

function LoginPlaceholder() {
  return <main>Login (port pending)</main>
}
