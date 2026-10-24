import { useCallback, useState, type FormEvent } from 'react';
import { getSettings, setLateCancelHours } from '../../data/settings';
import { t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { NoticeLine, type Notice } from '../shared/NoticeLine';

export function SettingsCutoff() {
  const load = useCallback(() => getSettings(supabase), []);
  const [state, reload] = useLoad(load);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [cutoff, setCutoff] = useState<string | null>(null);

  if (state.status === 'loading') return <p className="status">{t.common.loading}</p>;
  if (state.status === 'error') {
    return (
      <p role="alert" className="error">
        {t.common.loadFailed}
      </p>
    );
  }

  const cutoffValue = cutoff ?? String(state.data.lateCancelHours);

  async function save(event: FormEvent) {
    event.preventDefault();
    const hours = Number(cutoffValue);
    if (cutoffValue.trim() === '' || !Number.isInteger(hours) || hours < 0) {
      setNotice({ error: true, text: t.settings.cutoffInvalid });
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await setLateCancelHours(supabase, hours);
    setNotice(
      result.ok ? { error: false, text: t.settings.saved } : { error: true, text: result.message },
    );
    await reload();
    setBusy(false);
    if (result.ok) setCutoff(null);
  }

  return (
    <form className="form card" onSubmit={(e) => void save(e)} aria-label={t.settings.cutoffTitle}>
      <h2>{t.settings.cutoffTitle}</h2>
      <label>
        {t.settings.cutoffHours}
        <input
          type="number"
          inputMode="numeric"
          value={cutoffValue}
          onChange={(e) => setCutoff(e.target.value)}
        />
      </label>
      <NoticeLine notice={notice} />
      <button type="submit" className="button" disabled={busy}>
        {t.settings.save}
      </button>
    </form>
  );
}
