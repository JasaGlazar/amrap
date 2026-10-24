import { useCallback, useState } from 'react';
import { liveCountBetween } from '../../data/appointments';
import type { ActionResult } from '../../data/client';
import { getSettings } from '../../data/settings';
import { deleteBlocked, saveBlocked, upcomingBlocked, type BlockedPeriod } from '../../data/slots';
import { fill, fromError, t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { formatDay, formatTime, localDateOf } from '../../lib/time';
import { useLoad } from '../../lib/useLoad';
import { NoticeLine, type Notice } from '../shared/NoticeLine';
import { BlockedForm } from './BlockedForm';

export function SettingsBlocked() {
  const load = useCallback(async () => {
    const now = new Date();
    const [settings, blocked] = await Promise.all([
      getSettings(supabase),
      upcomingBlocked(supabase, now),
    ]);
    return { now, timeZone: settings.timeZone, blocked };
  }, []);
  const [state, reload] = useLoad(load);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [overlapKey, setOverlapKey] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState(0);

  if (state.status === 'loading') return <p className="status">{t.common.loading}</p>;
  if (state.status === 'error') {
    return (
      <p role="alert" className="error">
        {t.common.loadFailed}
      </p>
    );
  }

  const { now, timeZone, blocked } = state.data;

  async function run(action: () => Promise<ActionResult<unknown>>) {
    setBusy(true);
    setNotice(null);
    const result = await action();
    setNotice(
      result.ok ? { error: false, text: t.settings.saved } : { error: true, text: result.message },
    );
    await reload();
    setBusy(false);
    return result.ok;
  }

  async function store(id: string | null, period: BlockedPeriod) {
    const key = `${id}|${period.startsAt.toISOString()}|${period.endsAt.toISOString()}`;
    if (overlapKey !== key) {
      setBusy(true);
      setNotice(null);
      let count: number;
      try {
        count = await liveCountBetween(supabase, period.startsAt, period.endsAt, new Date());
      } catch (error) {
        console.warn('blocked overlap count failed', error);
        setNotice({ error: true, text: fromError(error) });
        return;
      } finally {
        setBusy(false);
      }
      if (count > 0) {
        setOverlapKey(key);
        setNotice({ error: true, text: fill(t.settings.blockedOverlapWarning, { count }) });
        return;
      }
    }
    if (await run(() => saveBlocked(supabase, id, period))) {
      setOverlapKey(null);
      setEditing(null);
      setFormVersion((value) => value + 1);
    }
  }

  const when = (instant: Date) =>
    fill(t.slot.when, { day: formatDay(instant, timeZone), time: formatTime(instant, timeZone) });

  return (
    <section aria-label={t.settings.blockedTitle}>
      <h2>{t.settings.blockedTitle}</h2>
      <NoticeLine notice={notice} />
      {blocked.length === 0 ? (
        <p>{t.settings.noBlocked}</p>
      ) : (
        <ul className="list">
          {blocked.map((period) =>
            editing === period.id ? (
              <li key={period.id}>
                <BlockedForm
                  title={t.settings.editBlocked}
                  initial={period}
                  defaultDate={localDateOf(now, timeZone)}
                  timeZone={timeZone}
                  busy={busy}
                  onSave={(next) => void store(period.id, next)}
                  onCancel={() => {
                    setOverlapKey(null);
                    setNotice(null);
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li key={period.id} className="row">
                <span className="ledger-main">
                  <span>
                    {fill(t.settings.blockedLine, {
                      from: when(period.startsAt),
                      to: when(period.endsAt),
                    })}
                  </span>
                  {period.reason !== null && <span className="detail">{period.reason}</span>}
                </span>
                <span className="actions">
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => setEditing(period.id)}
                  >
                    {t.settings.edit}
                  </button>
                  <button
                    type="button"
                    className="button danger small"
                    disabled={busy}
                    onClick={() => void run(() => deleteBlocked(supabase, period.id))}
                  >
                    {t.settings.delete}
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      <BlockedForm
        key={`new-blocked-${formVersion}`}
        title={t.settings.newBlocked}
        initial={null}
        defaultDate={localDateOf(now, timeZone)}
        timeZone={timeZone}
        busy={busy}
        onSave={(period) => void store(null, period)}
      />
    </section>
  );
}
