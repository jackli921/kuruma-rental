import { OperatorRegistrationForm } from '@/vite/operator-registration/OperatorRegistrationForm'
import { RegistrationSuccess } from '@/vite/operator-registration/RegistrationSuccess'
import { ApiError, submitOperatorApplication } from '@/vite/operator-registration/api'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Public operator registration page (#1277 §2.4). No beforeLoad guard -
// the recipient has no session. The `business` segment is a plain path
// segment, not the guarded `_business` pathless layout.
export const Route = createFileRoute('/$locale/business/register')({
  component: OperatorRegisterPage,
})

function OperatorRegisterPage() {
  const t = useTranslations('business.register')
  const mutation = useMutation({ mutationFn: submitOperatorApplication })

  // 409 = duplicate email/application; anything else is a generic server error.
  const errorText =
    mutation.error instanceof ApiError && mutation.error.status === 409
      ? t('errors.duplicate')
      : mutation.error
        ? t('errors.generic')
        : null

  if (mutation.isSuccess) {
    return <RegistrationSuccess email={mutation.variables?.contactEmail ?? ''} />
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
        isSubmitting={mutation.isPending}
      />
    </div>
  )
}
