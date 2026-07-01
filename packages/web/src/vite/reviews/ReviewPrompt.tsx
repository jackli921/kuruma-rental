import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useFeatureFlag } from '@/vite/config'
import { ReviewForm } from '@/vite/reviews/ReviewForm'
import { pendingReviewSubjects } from '@/vite/reviews/api'
import { useSession } from '@/vite/session'
import type { ReviewSubject } from '@kuruma/shared/enums'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

interface ReviewPromptProps {
  readonly bookingId: string
  readonly bookingCode: string
  /** Subjects the renter has already reviewed for this booking (resolved upstream). */
  readonly reviewedSubjects: readonly ReviewSubject[]
}

// #1083: the post-trip review CTA shown on a COMPLETED booking in My Bookings. It
// renders only while a subject is still unreviewed (both done -> nothing) and only
// for an authenticated session (the submit is CSRF-gated). Opens a dialog hosting the
// ReviewForm for exactly the pending subjects.
export function ReviewPrompt({ bookingId, bookingCode, reviewedSubjects }: ReviewPromptProps) {
  const t = useTranslations('reviews.prompt')
  const reviewsEnabled = useFeatureFlag('REVIEWS')
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const pending = pendingReviewSubjects(reviewedSubjects)

  // Reviews gated off (#1083-1086) → no post-trip prompt. Placed with the other
  // post-hooks guards so rules-of-hooks stays satisfied. Runtime-toggleable.
  if (!reviewsEnabled || pending.length === 0 || !session) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="self-start" />}>
        {t('cta')}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { code: bookingCode })}</DialogDescription>
        </DialogHeader>
        <ReviewForm
          bookingId={bookingId}
          csrfToken={session.csrfToken}
          subjects={pending}
          onSubmitted={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
