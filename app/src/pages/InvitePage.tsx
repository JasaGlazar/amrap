import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { fromError, t } from '../i18n';
import { supabase } from '../lib/supabase';

const MIN_PASSWORD_LENGTH = 6; // matches minimum_password_length in supabase/config.toml

// Sign-up with the token from the invite link (ADR 0006): create the auth user, then link it to
// the customer record with accept_invite.
export function InvitePage() {
  const { token = '' } = useParams();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [signedUp, setSignedUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) return setError(t.invite.passwordTooShort);
    if (password !== confirm) return setError(t.invite.passwordMismatch);

    setSubmitting(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        if (signUpError.code !== 'user_already_exists') return setError(fromError(signUpError));
        // An earlier attempt may have created the account without linking it (a dropped
        // request, or an invite that was replaced). Continue as that user if the password fits.
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          // A wrong password means the account is someone else's (or has another password).
          return setError(
            fromError(signInError.code === 'invalid_credentials' ? signUpError : signInError),
          );
        }
      } else if (data.session === null) {
        return setError(t.invite.noSession);
      }
      setSignedUp(true);

      const { error: acceptError } = await supabase.rpc('accept_invite', { p_token: token });
      if (acceptError) return setError(fromError(acceptError));

      // The provider cached "not linked" while the account was being created; reload it.
      await refresh();
      void navigate('/', { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page narrow">
      <h1>{t.app.name}</h1>
      <h2>{t.invite.title}</h2>
      <p>{t.invite.intro}</p>
      <form onSubmit={onSubmit} className="form">
        <label>
          {t.invite.email}
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          {t.invite.password}
          <input
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          {t.invite.confirmPassword}
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {signedUp && error !== null ? (
          <Link to="/" className="button">
            {t.common.continue}
          </Link>
        ) : (
          <button type="submit" className="button" disabled={submitting}>
            {submitting ? t.invite.submitting : t.invite.submit}
          </button>
        )}
      </form>
    </main>
  );
}
