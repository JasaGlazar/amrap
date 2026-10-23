import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n';

export function NotLinkedPage() {
  const { signOut } = useAuth();
  return (
    <main className="page narrow">
      <h1>{t.notLinked.title}</h1>
      <p>{t.notLinked.body}</p>
      <button type="button" className="button" onClick={() => void signOut()}>
        {t.common.signOut}
      </button>
    </main>
  );
}
