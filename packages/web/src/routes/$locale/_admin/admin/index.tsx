import { AdminHomeView } from '@/vite/admin/AdminHomeView'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/$locale/_admin/admin/')({
  component: AdminHomeView,
})
