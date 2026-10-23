import { t } from '../i18n';

export function StartupErrorPage({ error }: { error: unknown }) {
  return (
    <main className="page narrow">
      <h1>{t.startupError.title}</h1>
      <p>{t.startupError.body}</p>
      <p className="detail">{error instanceof Error ? error.message : String(error)}</p>
    </main>
  );
}
