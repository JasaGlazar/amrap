import { Link } from 'react-router';
import { t } from '../i18n';

export function NotLinkedPage() {
  return (
    <main className="page narrow">
      <h1>{t.notLinked.title}</h1>
      <p>{t.notLinked.body}</p>
      <p>{t.notLinked.finishHint}</p>
      <div className="actions">
        <Link to="/registracija" className="button">
          {t.notLinked.finish}
        </Link>
        <Link to="/logout" className="button secondary">
          {t.common.signOut}
        </Link>
      </div>
    </main>
  );
}
