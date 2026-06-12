import { RevenuePlaceholderView } from '@/vite/admin/RevenuePlaceholderView'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/$locale/_admin/admin/revenue')({
  component: RevenuePlaceholderView,
})
