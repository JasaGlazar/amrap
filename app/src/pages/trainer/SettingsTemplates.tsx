import { useCallback, useState } from 'react';
import { futureBookedCount } from '../../data/appointments';
import { allTemplates, saveTemplate, type TemplateFields } from '../../data/slots';
import { fill, fromError, plural, t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { weekdayName } from '../../lib/time';
import { useLoad } from '../../lib/useLoad';
import { NoticeLine, type Notice } from '../shared/NoticeLine';
import { OnDemand } from '../shared/OnDemand';
import { TemplateForm } from './TemplateForm';

const newTemplate: TemplateFields = {
  weekday: 0,
  start_time: '',
  duration_minutes: 60,
  capacity: 5,
  active: true,
};

export function SettingsTemplates() {
  const load = useCallback(() => allTemplates(supabase), []);
  const [state, reload] = useLoad(load);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [stranded, setStranded] = useState<{ key: string; id: string; count: number } | null>(null);
  const [adding, setAdding] = useState(false);

  if (state.status === 'loading') return <p className="status">{t.common.loading}</p>;
  if (state.status === 'error') {
    return (
      <p role="alert" className="error">
        {t.common.loadFailed}
      </p>
    );
  }

  const templates = state.data;

  async function store(id: string | null, fields: TemplateFields) {
    const before = templates.find((template) => template.id === id);
    const strands =
      before !== undefined &&
      before.active &&
      (!fields.active ||
        before.weekday !== fields.weekday ||
        before.start_time.slice(0, 5) !== fields.start_time.slice(0, 5));
    const key = `${id}|${JSON.stringify(fields)}`;
    setBusy(true);
    setNotice(null);
    if (strands && id !== null && stranded?.key !== key) {
      let count: number;
      try {
        count = await futureBookedCount(supabase, id, new Date());
      } catch (error) {
        console.warn('stranded booking count failed', error);
        setNotice({ error: true, text: fromError(error) });
        setBusy(false);
        return;
      }
      if (count > 0) {
        setStranded({ key, id, count });
        setBusy(false);
        return;
      }
    }
    const result = await saveTemplate(supabase, id, fields);
    setNotice(
      result.ok ? { error: false, text: t.settings.saved } : { error: true, text: result.message },
    );
    await reload();
    setBusy(false);
    if (result.ok) {
      setStranded(null);
      if (id === null) setAdding(false);
      else setEditing(null);
    }
  }

  return (
    <section aria-label={t.settings.templatesTitle}>
      <div className="head">
        <h2>{t.settings.templatesTitle}</h2>
        <OnDemand label={t.settings.newTemplate} add open={adding} onOpen={() => setAdding(true)}>
          <TemplateForm
            title={t.settings.newTemplate}
            initial={newTemplate}
            busy={busy}
            onSave={(fields) => void store(null, fields)}
            onCancel={() => {
              setNotice(null);
              setAdding(false);
            }}
          />
        </OnDemand>
      </div>
      <NoticeLine notice={notice} />
      {templates.length === 0 ? (
        <p>{t.settings.noTemplates}</p>
      ) : (
        <ul className="list">
          {templates.map((template) =>
            editing === template.id ? (
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
                  onSave={(fields) => void store(template.id, fields)}
                  onCancel={() => {
                    setStranded(null);
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li key={template.id} className={template.active ? 'row' : 'row muted'}>
                <span className="row-text">
                  <span>
                    {fill(t.settings.templateLine, {
                      weekday: weekdayName(template.weekday),
                      time: template.start_time.slice(0, 5),
                      minutes: template.duration_minutes,
                      places: plural(t.settings.places, template.capacity),
                    })}
                  </span>
                  {!template.active && <span className="tag">{t.settings.inactive}</span>}
                </span>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => setEditing(template.id)}
                >
                  {t.settings.edit}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
