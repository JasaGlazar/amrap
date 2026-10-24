import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { fromError, t } from '../i18n';
import { supabase } from '../lib/supabase';
import { BrandMark } from './shared/BrandMark';

export function LoginPage() {
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (session !== null) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    // On success the session change redirects this page; only a failure needs handling here.
    if (signInError) setError(fromError(signInError));
    setSubmitting(false);
  }

  return (
    <main className="page narrow">
      <h1 className="brand-heading">
        <BrandMark />
      </h1>
      <h2>{t.login.title}</h2>
      <form onSubmit={onSubmit} className="form">
        <label>
          {t.login.email}
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          {t.login.password}
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? t.login.submitting : t.login.submit}
        </button>
      </form>
    </main>
  );
}
