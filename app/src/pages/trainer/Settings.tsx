import { useCallback, useState, type FormEvent } from 'react';
import { futureBookedCount } from '../../data/appointments';
import type { ActionResult } from '../../data/client';
import { getSettings, setLateCancelHours } from '../../data/settings';
import {
  allTemplates,
  deleteBlocked,
  saveBlocked,
  saveTemplate,
  upcomingBlocked,
  type BlockedPeriod,
  type TemplateFields,
} from '../../data/slots';
import { fill, fromError, t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { formatDay, formatTime, localDateOf, weekdayName } from '../../lib/time';
import { useLoad } from '../../lib/useLoad';
import { NoticeLine, type Notice } from '../shared/NoticeLine';
import { BlockedForm } from './BlockedForm';
import { TemplateForm } from './TemplateForm';

const newTemplate: TemplateFields = {
  weekday: 0,
  start_time: '',
  duration_minutes: 60,
  capacity: 5,
  active: true,
};

export function TrainerSettings() {
  const load = useCallback(async () => {
    const now = new Date();
    const [settings, templates, blocked] = await Promise.all([
      getSettings(supabase),
      allTemplates(supabase),
      upcomingBlocked(supabase, now),
    ]);
    return { now, settings, templates, blocked };
  }, []);
  const [state, reload] = useLoad(load);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Record<string, Notice>>({});
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [stranded, setStranded] = useState<{ key: string; id: string; count: number } | null>(null);
  const [editingBlocked, setEditingBlocked] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [cutoff, setCutoff] = useState<string | null>(null);

  async function run(section: string, action: () => Promise<ActionResult<unknown>>) {
    setBusy(true);
    setNotice((current) => ({ ...current, [section]: null }));
    const result = await action();
    setNotice((current) => ({
      ...current,
      [section]: result.ok
        ? { error: false, text: t.settings.saved }
        : { error: true, text: result.message },
    }));
    await reload();
    setBusy(false);
    return result.ok;
  }

  if (state.status === 'loading') return <p className="status">{t.common.loading}</p>;
  if (state.status === 'error') {
    return (
      <p role="alert" className="error">
        {t.common.loadFailed}
      </p>
    );
  }

  const { now, settings, templates, blocked } = state.data;
  const { timeZone } = settings;
  const cutoffValue = cutoff ?? String(settings.lateCancelHours);

  async function saveCutoff(event: FormEvent) {
    event.preventDefault();
    const hours = Number(cutoffValue);
    if (cutoffValue.trim() === '' || !Number.isInteger(hours) || hours < 0) {
      setNotice((current) => ({
        ...current,
        cutoff: { error: true, text: t.settings.cutoffInvalid },
      }));
      return;
    }
    if (await run('cutoff', () => setLateCancelHours(supabase, hours))) setCutoff(null);
  }

  async function storeTemplate(id: string | null, fields: TemplateFields) {
    const before = templates.find((template) => template.id === id);
    const strands =
      before !== undefined &&
      before.active &&
      (!fields.active ||
        before.weekday !== fields.weekday ||
        before.start_time.slice(0, 5) !== fields.start_time.slice(0, 5));
    const key = `${id}|${JSON.stringify(fields)}`;
    if (strands && id !== null && stranded?.key !== key) {
      setBusy(true);
      setNotice((current) => ({ ...current, templates: null }));
      let count: number;
      try {
        count = await futureBookedCount(supabase, id, new Date());
      } catch (error) {
        console.warn('stranded booking count failed', error);
        setNotice((current) => ({
          ...current,
          templates: { error: true, text: fromError(error) },
        }));
        return;
      } finally {
        setBusy(false);
      }
      if (count > 0) {
        setStranded({ key, id, count });
        return;
      }
    }
    if (await run('templates', () => saveTemplate(supabase, id, fields))) {
      setStranded(null);
      setEditingTemplate(null);
      setFormVersion((value) => value + 1);
    }
  }

  async function storeBlocked(id: string | null, period: BlockedPeriod) {
    if (await run('blocked', () => saveBlocked(supabase, id, period))) {
      setEditingBlocked(null);
      setFormVersion((value) => value + 1);
    }
  }

  const when = (instant: Date) =>
    fill(t.slot.when, { day: formatDay(instant, timeZone), time: formatTime(instant, timeZone) });

  return (
    <>
      <h1>{t.trainer.settingsTitle}</h1>

      <section aria-label={t.settings.templatesTitle}>
        <h2>{t.settings.templatesTitle}</h2>
        <NoticeLine notice={notice.templates} />
        {templates.length === 0 && <p>{t.settings.noTemplates}</p>}
        <ul className="list">
          {templates.map((template) =>
            editingTemplate === template.id ? (
              <li key={template.id}>
                <TemplateForm
                  title={t.settings.editTemplate}
                  initial={template}
                  busy={busy}
                  warning={
                    stranded?.id === template.id
                      ? fill(t.settings.strandedWarning, { count: stranded.count })
                      : null
                  }
                  onSave={(fields) => void storeTemplate(template.id, fields)}
                  onCancel={() => {
                    setStranded(null);
                    setEditingTemplate(null);
                  }}
                />
              </li>
            ) : (
              <li key={template.id} className={template.active ? 'row' : 'row muted'}>
                <span>
                  {fill(t.settings.templateLine, {
                    weekday: weekdayName(template.weekday),
                    time: template.start_time.slice(0, 5),
                    minutes: template.duration_minutes,
                    capacity: template.capacity,
                  })}
                </span>
                {!template.active && <span className="tag">{t.settings.inactive}</span>}
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => setEditingTemplate(template.id)}
                >
                  {t.settings.edit}
                </button>
              </li>
            ),
          )}
        </ul>
        <TemplateForm
          key={`new-template-${formVersion}`}
          title={t.settings.newTemplate}
          initial={newTemplate}
          busy={busy}
          onSave={(fields) => void storeTemplate(null, fields)}
        />
      </section>

      <form
        className="form card"
        onSubmit={(e) => void saveCutoff(e)}
        aria-label={t.settings.cutoffTitle}
      >
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
        <NoticeLine notice={notice.cutoff} />
        <button type="submit" className="button" disabled={busy}>
          {t.settings.save}
        </button>
      </form>

      <section aria-label={t.settings.blockedTitle}>
        <h2>{t.settings.blockedTitle}</h2>
        <NoticeLine notice={notice.blocked} />
        {blocked.length === 0 && <p>{t.settings.noBlocked}</p>}
        <ul className="list">
          {blocked.map((period) =>
            editingBlocked === period.id ? (
              <li key={period.id}>
                <BlockedForm
                  title={t.settings.editBlocked}
                  initial={period}
                  defaultDate={localDateOf(now, timeZone)}
                  timeZone={timeZone}
                  busy={busy}
                  onSave={(next) => void storeBlocked(period.id, next)}
                  onCancel={() => setEditingBlocked(null)}
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
                    onClick={() => setEditingBlocked(period.id)}
                  >
                    {t.settings.edit}
                  </button>
                  <button
                    type="button"
                    className="button danger small"
                    disabled={busy}
                    onClick={() => void run('blocked', () => deleteBlocked(supabase, period.id))}
                  >
                    {t.settings.delete}
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
        <BlockedForm
          key={`new-blocked-${formVersion}`}
          title={t.settings.newBlocked}
          initial={null}
          defaultDate={localDateOf(now, timeZone)}
          timeZone={timeZone}
          busy={busy}
          onSave={(period) => void storeBlocked(null, period)}
        />
      </section>
    </>
  );
}
