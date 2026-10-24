import { useState, type FormEvent } from 'react';
import type { TemplateFields } from '../../data/slots';
import { t } from '../../i18n';
import { weekdayName } from '../../lib/time';

type Props = {
  title: string;
  initial: TemplateFields;
  busy: boolean;
  warnings?: string[];
  framed?: boolean;
  onSave: (fields: TemplateFields) => void;
  onCancel?: () => void;
};

const weekdays = [0, 1, 2, 3, 4, 5, 6];

function positiveInteger(value: string): number | null {
  const number = Number(value);
  return value.trim() !== '' && Number.isInteger(number) && number > 0 ? number : null;
}

export function TemplateForm({
  title,
  initial,
  busy,
  warnings = [],
  framed = true,
  onSave,
  onCancel,
}: Props) {
  const [weekday, setWeekday] = useState(String(initial.weekday));
  const [start, setStart] = useState(initial.start_time.slice(0, 5));
  const [duration, setDuration] = useState(String(initial.duration_minutes));
  const [capacity, setCapacity] = useState(String(initial.capacity));
  const [active, setActive] = useState(initial.active);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const minutes = positiveInteger(duration);
    const places = positiveInteger(capacity);
    if (start === '') return setError(t.settings.startRequired);
    if (minutes === null) return setError(t.settings.durationInvalid);
    if (places === null) return setError(t.settings.capacityInvalid);
    setError(null);
    onSave({
      weekday: Number(weekday),
      start_time: start,
      duration_minutes: minutes,
      capacity: places,
      active,
    });
  }

  return (
    <form className={framed ? 'form card' : 'form'} onSubmit={submit} aria-label={title}>
      <h3>{title}</h3>
      <div className="form-row">
        <label>
          {t.settings.weekday}
          <select value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            {weekdays.map((day) => (
              <option key={day} value={day}>
                {weekdayName(day)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.settings.startTime}
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
      </div>
      <div className="form-row">
        <label>
          {t.settings.duration}
          <input
            type="number"
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
        <label>
          {t.settings.capacity}
          <input
            type="number"
            inputMode="numeric"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </label>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        {t.settings.active}
      </label>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {warnings.map((warning) => (
        <p key={warning} role="alert" className="notice late">
          {warning}
        </p>
      ))}
      <div className="actions">
        <button type="submit" className="button" disabled={busy}>
          {t.settings.save}
        </button>
        {onCancel !== undefined && (
          <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>
            {t.settings.cancelEdit}
          </button>
        )}
      </div>
    </form>
  );
}
