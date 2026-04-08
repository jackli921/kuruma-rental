import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { OAuthButtons } from '@/modules/auth/OAuthButtons'

export default function LoginPage() {
  const t = useTranslations('auth')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('login')}</CardTitle>
      </CardHeader>
      <CardContent>
        <OAuthButtons />
      </CardContent>
    </Card>
  )
}
