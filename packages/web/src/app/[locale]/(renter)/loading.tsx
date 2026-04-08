const SKELETON_ROWS = ['row-1', 'row-2', 'row-3'] as const

export default function RenterLoading() {
  return (
    <main className="flex-1">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="h-8 w-48 bg-muted animate-pulse rounded-md" />
        <div className="mt-6 space-y-4">
          {SKELETON_ROWS.map((id) => (
            <div key={id} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    </main>
  )
}
