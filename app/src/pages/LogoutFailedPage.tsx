import { Link, useLoaderData } from 'react-router';
import { t } from '../i18n';

// Only rendered when the /logout loader did not redirect, i.e. signing out failed.
export function LogoutFailedPage() {
  const { message } = useLoaderData() as { message: string };
  return (
    <main className="page narrow">
      <h1>{t.logoutFailed.title}</h1>
      <p role="alert" className="error">
        {message}
      </p>
      <Link to="/" className="button">
        {t.common.continue}
      </Link>
    </main>
  );
}
