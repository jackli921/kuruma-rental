import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'
import { ADMIN_REPORTED_REVIEWS_QUERY_KEY, type ReportedReviewDto, hideReview } from './api'

interface Props {
  readonly reported: readonly ReportedReviewDto[]
}

/**
 * Platform-admin review moderation queue (#1086). Pure over its `reported` prop
 * (the route owns the fetch). Lists every reported review with its distinct-reporter
 * count + reasons; the admin soft-hides an abusive one (a report never auto-hides).
 */
export function ReviewModerationView({ reported }: Props) {
  const t = useTranslations('admin.reviewModeration')

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </header>

      {reported.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {reported.map((entry) => (
            <ReportedReviewRow key={entry.review.id} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ReportedReviewRow({ entry }: { readonly entry: ReportedReviewDto }) {
  const t = useTranslations('admin.reviewModeration')
  const csrfToken = useSession().data?.csrfToken ?? ''
  const queryClient = useQueryClient()

  const { mutate, isPending, isError } = useMutation({
    mutationFn: hideReview,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_REPORTED_REVIEWS_QUERY_KEY }),
  })

  const { review, reportCount, reasons } = entry
  const isHidden = review.moderationStatus === 'HIDDEN'

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="text-sm text-muted-foreground">
          {t(`subject.${review.subject}`)} · {t(`by.${review.authorRole}`)} ·{' '}
          {t('stars', { n: review.overall })}
        </div>
        {isHidden ? (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {t('hidden')}
          </span>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => mutate({ id: review.id, csrfToken })}
            className="shrink-0 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {isPending ? t('hiding') : t('hide')}
          </button>
        )}
      </div>

      {review.comment ? <p className="mt-2 text-sm text-foreground">{review.comment}</p> : null}

      <div className="mt-3 text-xs font-medium text-muted-foreground">
        {t('reports', { count: reportCount })}
      </div>
      <ul className="mt-1 flex flex-wrap gap-2">
        {reasons.map((reason, i) => (
          <li
            key={`${review.id}-${i}`}
            className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          >
            {reason}
          </li>
        ))}
      </ul>

      {isError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t('hideError')}
        </p>
      ) : null}
    </li>
  )
}
