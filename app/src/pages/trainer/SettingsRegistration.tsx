import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getRegistrationCode,
  newRegistrationCode,
  setRegistrationCode,
} from '../../data/registration';
import { t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { NoticeLine, type Notice } from '../shared/NoticeLine';
import { OnDemand } from '../shared/OnDemand';

const r = t.settings.registration;

type Confirming = 'newCode' | 'close' | null;

export function SettingsRegistration() {
  const load = useCallback(() => getRegistrationCode(supabase), []);
  const [state, reload] = useLoad(load);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const saved = useRef(false);

  useEffect(() => {
    if (!saved.current || busy) return;
    saved.current = false;
    if (document.activeElement === null || document.activeElement === document.body) {
      heading.current?.focus();
    }
  }, [busy]);

  if (state.status === 'loading') return <p className="status">{t.common.loading}</p>;
  if (state.status === 'error') {
    return (
      <p role="alert" className="error">
        {t.common.loadFailed}
      </p>
    );
  }

  const code = state.data;
  const link =
    code === null
      ? null
      : `${window.location.origin}/registracija?koda=${encodeURIComponent(code)}`;

  async function save(next: string | null) {
    setBusy(true);
    setNotice(null);
    const result = await setRegistrationCode(supabase, next);
    setNotice(
      result.ok ? { error: false, text: t.settings.saved } : { error: true, text: result.message },
    );
    setConfirming(null);
    await reload();
    saved.current = true;
    setBusy(false);
  }

  async function copyLink(value: string) {
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch (error) {
      console.warn('copy failed', error);
    }
    setNotice(copied ? { error: false, text: r.copied } : { error: true, text: r.copyFailed });
  }

  function confirmation(kind: 'newCode' | 'close') {
    const [label, warning, confirm, next] =
      kind === 'newCode'
        ? [r.newCode, r.newCodeWarning, r.confirmNewCode, () => newRegistrationCode()]
        : [r.close, r.closeWarning, r.confirmClose, () => null];
    return (
      <OnDemand
        label={label}
        className="button secondary"
        open={confirming === kind}
        onOpen={() => {
          setNotice(null);
          setConfirming(kind);
        }}
      >
        <div className="card">
          <p>{warning}</p>
          <div className="actions">
            <button
              type="button"
              className="button danger"
              disabled={busy}
              autoFocus
              onClick={() => void save(next())}
            >
              {confirm}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirming(null)}
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      </OnDemand>
    );
  }

  return (
    <section aria-label={r.title}>
      <h2 ref={heading} tabIndex={-1}>
        {r.title}
      </h2>
      {link === null ? (
        <>
          <p>{r.closed}</p>
          <p className="detail">{r.closedHint}</p>
          <NoticeLine notice={notice} />
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void save(newRegistrationCode())}
          >
            {r.openAction}
          </button>
        </>
      ) : (
        <>
          <p>{r.open}</p>
          <div className="form">
            <label>
              {r.link}
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
            </label>
            <p className="detail">{r.openHint}</p>
            <button type="button" className="button secondary" onClick={() => void copyLink(link)}>
              {r.copy}
            </button>
          </div>
          <NoticeLine notice={notice} />
          <div className={confirming === null ? 'actions' : undefined}>
            {confirming !== 'close' && confirmation('newCode')}
            {confirming !== 'newCode' && confirmation('close')}
          </div>
        </>
      )}
    </section>
  );
}
