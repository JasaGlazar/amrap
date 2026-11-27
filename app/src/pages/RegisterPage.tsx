import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { registerCustomer } from '../data/registration';
import { fromError, t } from '../i18n';
import { supabase } from '../lib/supabase';
import { LookupFailedPage } from './LookupFailedPage';
import { BrandMark } from './shared/BrandMark';

const MIN_PASSWORD_LENGTH = 6; // matches minimum_password_length in supabase/config.toml
const NAME_LENGTH = { min: 2, max: 80 }; // the bounds register_customer checks
const PHONE_LENGTH = { min: 6, max: 30 };

function lengthWithin(value: string, { min, max }: { min: number; max: number }): boolean {
  const length = value.trim().length;
  return length >= min && length <= max;
}

export function RegisterPage() {
  const [params] = useSearchParams();
  const code = (params.get('koda') ?? '').trim();
  const { loading, session, customer, lookupFailed, refresh } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [accountExists, setAccountExists] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Signing up changes the auth state mid-submit; keep the form on screen meanwhile.
  if (loading && !submitting) return <p className="status">{t.common.loading}</p>;
  if (customer !== null) return <Navigate to="/" replace />;
  if (lookupFailed && !submitting) return <LookupFailedPage />;
  const signedIn = session !== null;

  async function signUpOrSignIn(): Promise<boolean> {
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (!signUpError) {
      if (data.session !== null) return true;
      setError(t.register.noSession);
      return false;
    }
    if (signUpError.code !== 'user_already_exists') {
      setError(fromError(signUpError));
      return false;
    }
    // An earlier attempt may have created the account without a record.
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (!signInError) return true;
    if (signInError.code === 'invalid_credentials') setAccountExists(true);
    else setError(fromError(signInError));
    return false;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setAccountExists(false);
    if (!lengthWithin(name, NAME_LENGTH)) return setError(t.register.nameLength);
    if (!lengthWithin(phone, PHONE_LENGTH)) return setError(t.register.phoneLength);
    if (!signedIn) {
      if (password.length < MIN_PASSWORD_LENGTH) return setError(t.register.passwordTooShort);
      if (password !== confirm) return setError(t.register.passwordMismatch);
    }

    setSubmitting(true);
    try {
      if (!signedIn && !(await signUpOrSignIn())) return;

      const result = await registerCustomer(supabase, { name, phone, code });
      if (!result.ok) return setError(result.message);

      // The provider cached "not linked" while the account was being created; reload it.
      await refresh();
      void navigate('/', { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page narrow">
      <h1 className="brand-heading">
        <BrandMark />
      </h1>
      <h2>{t.register.title}</h2>
      {code === '' ? (
        <>
          <p>{t.register.noCode}</p>
          {signedIn && (
            <div className="actions">
              <Link to="/logout" className="button secondary">
                {t.common.signOut}
              </Link>
            </div>
          )}
        </>
      ) : (
        <>
          <p>{signedIn ? t.register.finishIntro : t.register.intro}</p>
          <form onSubmit={onSubmit} className="form">
            <label>
              {t.register.name}
              <input
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              {t.register.phone}
              <input
                type="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            {!signedIn && (
              <>
                <label>
                  {t.register.email}
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label>
                  {t.register.password}
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label>
                  {t.register.confirmPassword}
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </label>
              </>
            )}
            {error !== null && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {accountExists && (
              <p role="alert" className="error">
                {t.register.accountExists} <Link to="/login">{t.register.signIn}</Link>
              </p>
            )}
            <button type="submit" className="button" disabled={submitting}>
              {submitting
                ? t.register.submitting
                : signedIn
                  ? t.register.finish
                  : t.register.submit}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
