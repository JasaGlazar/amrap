import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n';

export function LookupFailedPage() {
  const { refresh } = useAuth();
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
        <Link to="/logout" className="button secondary">
          {t.common.signOut}
        </Link>
      </div>
    </main>
  );
}
