import { useCallback, useState } from 'react';
import { futureBookedCount } from '../../data/appointments';
import { allTemplates, saveTemplate, type TemplateFields } from '../../data/slots';
import { fill, fromError, t } from '../../i18n';
import { overlapsWith } from '../../lib/schedule';
import { supabase } from '../../lib/supabase';
import { weekdayName } from '../../lib/time';
import { useLoad } from '../../lib/useLoad';
import { useMediaQuery, wideScreen } from '../../lib/useMediaQuery';
import { NoticeLine, type Notice } from '../shared/NoticeLine';
import { OnDemand } from '../shared/OnDemand';
import { TemplateDialog } from './TemplateDialog';
import { TemplateForm } from './TemplateForm';
import { DayGroups, WeekGrid, type WeekTemplate } from './TemplateWeek';

const newTemplate: TemplateFields = {
  weekday: 0,
  start_time: '',
  duration_minutes: 60,
  capacity: 5,
  active: true,
};

type Warnings = {
  key: string;
  id: string | null;
  others: WeekTemplate[];
  count: number;
};

export function SettingsTemplates() {
  const load = useCallback(() => allTemplates(supabase), []);
  const [state, reload] = useLoad(load);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warnings | null>(null);
  const [adding, setAdding] = useState(false);
  const wide = useMediaQuery(wideScreen);

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
    if (warnings?.key !== key) {
      const already = before === undefined ? [] : overlapsWith(before, id, templates);
      const others = overlapsWith(fields, id, templates).filter(
        (other) => !already.includes(other),
      );
      let count = 0;
      if (strands && id !== null) {
        try {
          count = await futureBookedCount(supabase, id, new Date());
        } catch (error) {
          console.warn('stranded booking count failed', error);
          setNotice({ error: true, text: fromError(error) });
          setBusy(false);
          return;
        }
      }
      if (others.length > 0 || count > 0) {
        setWarnings({ key, id, others, count });
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
      setWarnings(null);
      if (id === null) setAdding(false);
      else setEditing(null);
    }
  }

  function warningLines(id: string | null): string[] {
    if (warnings === null || warnings.id !== id) return [];
    const lines: string[] = [];
    if (warnings.others.length > 0) {
      const slots = new Intl.ListFormat('sl', { type: 'conjunction' }).format(
        warnings.others.map((other) =>
          fill(t.settings.overlapSlot, {
            weekday: weekdayName(other.weekday),
            time: other.start_time.slice(0, 5),
            minutes: other.duration_minutes,
          }),
        ),
      );
      const count = warnings.others.length;
      const form = count === 1 ? 'single' : count === 2 ? 'pair' : 'several';
      const text = fill(t.settings.overlapWarning[form], { slots });
      lines.push(warnings.count > 0 ? text : `${text} ${t.settings.confirmAgain}`);
    }
    if (warnings.count > 0) lines.push(fill(t.settings.strandedWarning, { count: warnings.count }));
    return lines;
  }

  function openEdit(id: string) {
    setNotice(null);
    setEditing(id);
  }

  function closeEdit() {
    setWarnings(null);
    setNotice(null);
    setEditing(null);
  }

  function editForm(template: WeekTemplate, framed: boolean) {
    return (
      <TemplateForm
        title={t.settings.editTemplate}
        initial={template}
        busy={busy}
        framed={framed}
        warnings={warningLines(template.id)}
        onSave={(fields) => void store(template.id, fields)}
        onCancel={closeEdit}
      />
    );
  }

  const editedTemplate = templates.find((template) => template.id === editing);

  return (
    <section aria-label={t.settings.templatesTitle}>
      <div className="head">
        <h2>{t.settings.templatesTitle}</h2>
        <OnDemand
          label={t.settings.newTemplate}
          className="button secondary"
          add
          open={adding}
          onOpen={() => setAdding(true)}
        >
          <TemplateForm
            title={t.settings.newTemplate}
            initial={newTemplate}
            busy={busy}
            onSave={(fields) => void store(null, fields)}
            warnings={warningLines(null)}
            onCancel={() => {
              setWarnings(null);
              setNotice(null);
              setAdding(false);
            }}
          />
        </OnDemand>
      </div>
      <NoticeLine notice={wide && editedTemplate !== undefined ? null : notice} />
      {templates.length === 0 ? (
        <p>{t.settings.noTemplates}</p>
      ) : wide ? (
        <WeekGrid templates={templates} onEdit={openEdit} />
      ) : (
        <DayGroups
          templates={templates}
          onEdit={openEdit}
          editing={editing}
          editForm={(template) => editForm(template, true)}
        />
      )}
      {wide && editedTemplate !== undefined && (
        <TemplateDialog templateId={editedTemplate.id} busy={busy} onClose={closeEdit}>
          {editForm(editedTemplate, false)}
          {notice?.error === true && <NoticeLine notice={notice} />}
        </TemplateDialog>
      )}
    </section>
  );
}
