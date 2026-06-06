import { Outlet, createRootRoute } from '@tanstack/react-router'

// Minimal root for the phase-5a build proof. Phase 5b adds the QueryClient +
// use-intl providers and the FOUC bootstrap; 5c adds the session-aware layouts.
export const Route = createRootRoute({
  component: () => <Outlet />,
})
