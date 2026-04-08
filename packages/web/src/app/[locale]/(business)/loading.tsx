const SKELETON_CARDS = ['card-1', 'card-2', 'card-3', 'card-4', 'card-5', 'card-6'] as const

export default function BusinessLoading() {
  return (
    <main className="flex-1">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="h-8 w-48 bg-muted animate-pulse rounded-md" />
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {SKELETON_CARDS.map((id) => (
            <div key={id} className="h-40 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    </main>
  )
}
