import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api-error'
import { StarRating } from '@/vite/reviews/StarRating'
import {
  RENTER_OPERATOR_DIMENSIONS,
  REVIEWS_KEY,
  type RenterReviewSubject,
  type SubmitReviewInput,
  submitReview,
} from '@/vite/reviews/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslations } from 'use-intl'

// Mirrors the server's submitReviewSchema comment cap so the textarea can't submit a
// body the API would 400.
const COMMENT_MAX = 2000

interface ReviewFormProps {
  readonly bookingId: string
  readonly csrfToken: string
  /** The subjects still pending for this booking, in render order. */
  readonly subjects: readonly RenterReviewSubject[]
  readonly onSubmitted: () => void
}

// #1083: the renter rates each pending subject (operator + vehicle) and submits them
// together. Overall (1-5) is required per subject; the operator sub-dimensions and the
// comment are optional. One POST /reviews per subject; a benign 409 (a double-submit
// got there first) settles like success. On success it invalidates the reviews prefix
// so the prompt disappears, and closes via onSubmitted.
export function ReviewForm({ bookingId, csrfToken, subjects, onSubmitted }: ReviewFormProps) {
  const t = useTranslations('reviews.form')
  const queryClient = useQueryClient()
  const [overall, setOverall] = useState<Record<string, number>>({})
  const [comment, setComment] = useState<Record<string, string>>({})
  const [dims, setDims] = useState<Record<string, number>>({})

  function settle() {
    queryClient.invalidateQueries({ queryKey: REVIEWS_KEY })
    onSubmitted()
  }

  const mutation = useMutation({
    mutationFn: (inputs: SubmitReviewInput[]) =>
      Promise.all(inputs.map((input) => submitReview(input, csrfToken))),
    onSuccess: settle,
    onError: (error) => {
      // 409 ALREADY_REVIEWED: the renter's intent is already on record, so settle
      // and close rather than surface an error for an idempotent re-submit.
      if (error instanceof ApiError && error.status === 409) settle()
    },
  })

  // Synchronous in-flight guard: isPending only flips between renders, so a
  // double-click in one frame would fire two submits (mirrors CancelBookingDialog).
  const inFlightRef = useRef(false)
  if (!mutation.isPending && inFlightRef.current) inFlightRef.current = false

  const ready = subjects.every((s) => (overall[s] ?? 0) >= 1)

  function buildInputs(): SubmitReviewInput[] {
    return subjects.map((subject) => {
      const text = comment[subject]?.trim()
      const base: SubmitReviewInput = {
        bookingId,
        subject,
        overall: overall[subject] ?? 0,
        ...(text ? { comment: text } : {}),
      }
      if (subject !== 'OPERATOR') return base
      const entries = RENTER_OPERATOR_DIMENSIONS.map((d) => [d, dims[d] ?? 0] as const).filter(
        ([, v]) => v >= 1,
      )
      return entries.length > 0 ? { ...base, subRatings: Object.fromEntries(entries) } : base
    })
  }

  function handleSubmit() {
    if (!ready || inFlightRef.current || mutation.isPending) return
    inFlightRef.current = true
    mutation.mutate(buildInputs())
  }

  const showError =
    mutation.isError && !(mutation.error instanceof ApiError && mutation.error.status === 409)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
      className="space-y-5"
    >
      {subjects.map((subject) => (
        <fieldset key={subject} className="space-y-2">
          <legend className="text-sm font-semibold">{t(`subject.${subject}`)}</legend>
          <StarRating
            name={`overall-${subject}`}
            label={t('overall')}
            value={overall[subject] ?? 0}
            onChange={(v) => setOverall((prev) => ({ ...prev, [subject]: v }))}
            starLabel={(n) => t('starLabel', { n })}
          />
          {subject === 'OPERATOR'
            ? RENTER_OPERATOR_DIMENSIONS.map((d) => (
                <StarRating
                  key={d}
                  name={`dim-${subject}-${d}`}
                  label={t(`dimension.${d}`)}
                  value={dims[d] ?? 0}
                  onChange={(v) => setDims((prev) => ({ ...prev, [d]: v }))}
                  starLabel={(n) => t('starLabel', { n })}
                />
              ))
            : null}
          <Textarea
            value={comment[subject] ?? ''}
            onChange={(e) => setComment((prev) => ({ ...prev, [subject]: e.target.value }))}
            placeholder={t('commentPlaceholder')}
            aria-label={t('commentLabel', { subject: t(`subject.${subject}`) })}
            rows={2}
            maxLength={COMMENT_MAX}
          />
        </fieldset>
      ))}
      {showError ? <output className="block text-sm text-destructive">{t('error')}</output> : null}
      <Button type="submit" disabled={!ready || mutation.isPending} className="w-full">
        {mutation.isPending ? t('pending') : t('submit')}
      </Button>
    </form>
  )
}
