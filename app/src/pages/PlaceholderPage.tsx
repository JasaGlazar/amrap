import { t } from '../i18n';

// Stage 1 stand-in for screens that arrive in Stage 2.
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <h1>{title}</h1>
      <p>{t.common.comingSoon}</p>
    </>
  );
}
