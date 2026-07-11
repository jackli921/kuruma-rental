import type { SaveOperatorTermsDraftInput } from '@kuruma/shared/validators/consent-documents'

export interface TermsFormValues {
  titleEn: string
  bodyEn: string
  labelEn: string
  titleJa: string
  bodyJa: string
  labelJa: string
  titleZh: string
  bodyZh: string
  labelZh: string
}

// All-or-omit: a locale is included only when title, body, AND label are all
// non-blank; otherwise it is dropped (the API falls back to en at read).
function locale(
  t: string,
  b: string,
  l: string,
): { title: string; body: string; acceptanceLabel: string } | undefined {
  const [tt, bb, ll] = [t.trim(), b.trim(), l.trim()]
  return tt && bb && ll ? { title: tt, body: bb, acceptanceLabel: ll } : undefined
}

export function buildTermsBundle(v: TermsFormValues): SaveOperatorTermsDraftInput {
  const en = locale(v.titleEn, v.bodyEn, v.labelEn)
  if (!en) throw new Error('English terms are required')
  const out: SaveOperatorTermsDraftInput = { en }
  const ja = locale(v.titleJa, v.bodyJa, v.labelJa)
  if (ja) out.ja = ja
  const zh = locale(v.titleZh, v.bodyZh, v.labelZh)
  if (zh) out.zh = zh
  return out
}
