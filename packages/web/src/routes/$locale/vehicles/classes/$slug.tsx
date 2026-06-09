import { ClassDetailView } from '@/vite/vehicles/ClassDetailView'
import { classBySlugQueryOptions } from '@/vite/vehicles/classes'
import { createFileRoute, notFound } from '@tanstack/react-router'

// Public class detail (#388). The loader resolves the slug via the catalog
// query options and 404s on an unknown/archived class, so the component renders
// a guaranteed-present class (no null branch in the view).
export const Route = createFileRoute('/$locale/vehicles/classes/$slug')({
  loader: async ({ context, params }) => {
    const vehicleClass = await context.queryClient.ensureQueryData(
      classBySlugQueryOptions(params.slug),
    )
    if (!vehicleClass) throw notFound()
    return vehicleClass
  },
  component: ClassDetailRoute,
})

function ClassDetailRoute() {
  const vehicleClass = Route.useLoaderData()

  return (
    <main className="flex-1 py-10 px-4 sm:px-6 lg:px-8">
      <ClassDetailView vehicleClass={vehicleClass} />
    </main>
  )
}
