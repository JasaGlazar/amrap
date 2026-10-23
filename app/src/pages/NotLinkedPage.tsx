import { Link } from 'react-router';
import { t } from '../i18n';

export function NotLinkedPage() {
  return (
    <main className="page narrow">
      <h1>{t.notLinked.title}</h1>
      <p>{t.notLinked.body}</p>
      <Link to="/logout" className="button">
        {t.common.signOut}
      </Link>
    </main>
  );
}
