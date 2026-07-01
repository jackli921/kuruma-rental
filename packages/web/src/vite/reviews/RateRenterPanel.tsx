import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { isReviewsEnabled } from '@/vite/config'
import { StarRating } from '@/vite/reviews/StarRating'
import {
  OPERATOR_RENTER_DIMENSIONS,
  REVIEWS_KEY,
  operatorReviewedRenter,
  reviewsForBookingQueryOptions,
  submitReview,
} from '@/vite/reviews/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslations } from 'use-intl'

// Mirrors the server's submitReviewSchema comment cap so the textarea can't submit a
// body the API would 400.
const COMMENT_MAX = 2000

interface RateRenterPanelProps {
  readonly bookingId: string
  readonly bookingCode: string
  readonly csrfToken: string
}

// #1084: the operator rates the renter from a COMPLETED booking's business detail. One
// subject (RENTER) with a required overall + three optional sub-dimensions; a single POST
// /reviews (no Promise.allSettled — there is only one write). It reads the booking's
// reviews to decide visibility: once ANY staff member of the operator has reviewed
// (#1158 — the review is the tenant's, and the API surfaces a colleague's hidden row to
// operator staff), the panel shows a "reviewed" line instead of the form.
export function RateRenterPanel({ bookingId, bookingCode, csrfToken }: RateRenterPanelProps) {
  const t = useTranslations('reviews.operatorPanel')
  const queryClient = useQueryClient()
  const { data: reviews = [] } = useQuery(reviewsForBookingQueryOptions(bookingId))
  const [open, setOpen] = useState(false)
  const [overall, setOverall] = useState(0)
  const [comment, setComment] = useState('')
  const [dims, setDims] = useState<Record<string, number>>({})

  const mutation = useMutation({
    mutationFn: () => {
      const entries = OPERATOR_RENTER_DIMENSIONS.map((d) => [d, dims[d] ?? 0] as const).filter(
        ([, v]) => v >= 1,
      )
      const text = comment.trim()
      return submitReview(
        {
          bookingId,
          subject: 'RENTER',
          overall,
          ...(entries.length > 0 ? { subRatings: Object.fromEntries(entries) } : {}),
          ...(text ? { comment: text } : {}),
        },
        csrfToken,
      )
    },
    // Refresh the reviews read either way: on success the panel flips to "reviewed"; on
    // error (e.g. a benign 409 if a colleague got there first) the read still reflects
    // server truth so the panel settles correctly on reopen.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REVIEWS_KEY })
      setOpen(false)
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: REVIEWS_KEY })
    },
  })

  // Synchronous in-flight guard: isPending only flips between renders, so a double-click
  // in one frame would otherwise fire two submits (mirrors ReviewForm).
  const inFlightRef = useRef(false)
  if (!mutation.isPending && inFlightRef.current) inFlightRef.current = false

  // Reviews gated off (#1083-1086) → operators can't rate renters. After all hooks
  // so rules-of-hooks stays satisfied.
  if (!isReviewsEnabled()) return null

  const ready = overall >= 1
  function handleSubmit() {
    if (!ready || inFlightRef.current || mutation.isPending) return
    inFlightRef.current = true
    mutation.mutate()
  }

  if (operatorReviewedRenter(reviews)) {
    return <p className="text-sm text-muted-foreground">{t('reviewed')}</p>
  }

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
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
          className="space-y-5"
        >
          <fieldset className="space-y-2">
            <StarRating
              name="overall-renter"
              label={t('overall')}
              value={overall}
              onChange={setOverall}
              starLabel={(n) => t('starLabel', { n })}
            />
            {OPERATOR_RENTER_DIMENSIONS.map((d) => (
              <StarRating
                key={d}
                name={`dim-renter-${d}`}
                label={t(`dimension.${d}`)}
                value={dims[d] ?? 0}
                onChange={(v) => setDims((prev) => ({ ...prev, [d]: v }))}
                starLabel={(n) => t('starLabel', { n })}
              />
            ))}
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('commentPlaceholder')}
              aria-label={t('commentLabel')}
              rows={2}
              maxLength={COMMENT_MAX}
            />
          </fieldset>
          {mutation.isError ? (
            <output className="block text-sm text-destructive">{t('error')}</output>
          ) : null}
          <Button type="submit" disabled={!ready || mutation.isPending} className="w-full">
            {mutation.isPending ? t('pending') : t('submit')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
