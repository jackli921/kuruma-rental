import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { OAuthButtons } from '@/modules/auth/OAuthButtons'
import { useTranslations } from 'next-intl'

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
