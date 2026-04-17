import { auth } from '@/auth'
import { MessagingLayout } from '@/components/messaging/MessagingLayout'
import { getLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'

export default async function ManageMessagesPage() {
  const [session, locale] = await Promise.all([auth(), getLocale()])

  if (!session?.user?.id) {
    redirect(`/${locale}/login`)
  }

  return <MessagingLayout currentUserId={session.user.id} />
}
