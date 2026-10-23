import { t } from '../i18n';

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <h1>{title}</h1>
      <p>{t.common.comingSoon}</p>
    </>
  );
}
