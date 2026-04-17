import { BookingDetailStub } from './BookingDetailStub'

interface BookingDetailPageProps {
  params: Promise<{ id: string; locale: string }>
}

export default async function ManageBookingDetailPage({ params }: BookingDetailPageProps) {
  const { id } = await params
  return <BookingDetailStub id={id} />
}
