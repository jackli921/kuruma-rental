import { OperatorRegistrationForm } from '@/vite/operator-registration/OperatorRegistrationForm'
import { RegistrationSuccess } from '@/vite/operator-registration/RegistrationSuccess'
import { ApiError, submitOperatorApplication } from '@/vite/operator-registration/api'
import { sessionQueryOptions, useSession } from '@/vite/session'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Sign-in-first operator registration (#877). The POST /operator-applications
// endpoint is authed — it derives the applicant email + id from the session — so
// this route requires a session. The `business` segment is a plain path segment,
// not the guarded `_business` pathless layout, so it carries its own beforeLoad:
//   - signed out               → login (carrying returnTo so OAuth lands back here)
//   - already an operator       → dashboard (OWNER or STAFF; the API also 409s)
//   - other signed-in (renter)  → render the form
export const Route = createFileRoute('/$locale/business/register')({
  beforeLoad: async ({ context, params, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    if (!session) {
      throw redirect({
        to: '/$locale/login',
        params: { locale: params.locale },
        search: { returnTo: location.pathname },
      })
    }
    // operatorId marks an operator session (OWNER or STAFF); operatorSlug is set only
    // for OWNER — check both so a STAFF member lands on their portal, not the form.
    if (session.user.operatorId || session.user.operatorSlug) {
      throw redirect({ to: '/$locale/dashboard', params: { locale: params.locale } })
    }
    // Signed-in non-operator (renter) — fall through. The API stays the final
    // authority (server-derived email + already-operator 409).
  },
  component: OperatorRegisterPage,
})

function OperatorRegisterPage() {
  const t = useTranslations('business.register')
  const session = useSession().data
  const accountEmail = session?.user.email ?? ''
  const csrfToken = session?.csrfToken ?? ''
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof submitOperatorApplication>[0]) =>
      submitOperatorApplication(input, csrfToken),
  })

  // 409 = duplicate email/application; anything else is a generic server error.
  const errorText =
    mutation.error instanceof ApiError && mutation.error.status === 409
      ? t('errors.duplicate')
      : mutation.error
        ? t('errors.generic')
        : null

  if (mutation.isSuccess) {
    return <RegistrationSuccess email={accountEmail} />
  }

  return (
    <div className="mx-auto max-w-lg py-12 px-4 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>

      {errorText && (
        <p role="alert" className="text-sm text-destructive">
          {errorText}
        </p>
      )}

      <OperatorRegistrationForm
        onSubmit={(v) => mutation.mutate(v)}
        accountEmail={accountEmail}
        isSubmitting={mutation.isPending}
      />
    </div>
  )
}
