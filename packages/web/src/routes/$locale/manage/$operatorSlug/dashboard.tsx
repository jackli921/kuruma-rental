import { createFileRoute } from '@tanstack/react-router'

// Minimal operator landing (#521 §8) — gives the guarded `$operatorSlug` layout a
// reachable child so the provider click-through ends somewhere. The real operator
// dashboard/booking view ports in #512.
export const Route = createFileRoute('/$locale/manage/$operatorSlug/dashboard')({
  component: ManageDashboard,
})

function ManageDashboard() {
  const { operatorSlug } = Route.useParams()
  return <main className="p-8">Operator dashboard for {operatorSlug} (port pending — #512)</main>
}
