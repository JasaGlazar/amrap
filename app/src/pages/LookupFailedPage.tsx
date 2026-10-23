import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n';

// Shown when the customers lookup failed, so a network error or a paused project is not
// mistaken for an account that is not linked.
export function LookupFailedPage() {
  const { refresh, signOut } = useAuth();
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    await refresh();
    setRetrying(false);
  }

  return (
    <main className="page narrow">
      <h1>{t.lookupFailed.title}</h1>
      <p>{t.lookupFailed.body}</p>
      <div className="actions">
        <button type="button" className="button" disabled={retrying} onClick={() => void retry()}>
          {t.lookupFailed.retry}
        </button>
        <button type="button" className="button secondary" onClick={() => void signOut()}>
          {t.common.signOut}
        </button>
      </div>
    </main>
  );
}
