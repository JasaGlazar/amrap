import { useState, type FormEvent } from 'react';
import type { BlockedPeriod } from '../../data/slots';
import { t } from '../../i18n';
import { localParts, zonedInstant, type LocalDate } from '../../lib/time';

type Props = {
  title: string;
  initial: BlockedPeriod | null;
  defaultDate: LocalDate;
  timeZone: string;
  busy: boolean;
  onSave: (period: BlockedPeriod) => void;
  onCancel?: () => void;
};

function parts(instant: Date | undefined, timeZone: string, fallbackDate: LocalDate) {
  if (instant === undefined) return { date: fallbackDate, time: '' };
  const local = localParts(instant, timeZone);
  return { date: local.date, time: local.time.slice(0, 5) };
}

export function BlockedForm({
  title,
  initial,
  defaultDate,
  timeZone,
  busy,
  onSave,
  onCancel,
}: Props) {
  const from = parts(initial?.startsAt, timeZone, defaultDate);
  const to = parts(initial?.endsAt, timeZone, defaultDate);
  const [fromDate, setFromDate] = useState(from.date);
  const [fromTime, setFromTime] = useState(from.time);
  const [toDate, setToDate] = useState(to.date);
  const [toTime, setToTime] = useState(to.time);
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const startsAt = zonedInstant(fromDate, fromTime, timeZone);
    const endsAt = zonedInstant(toDate, toTime, timeZone);
    if (startsAt === null || endsAt === null) return setError(t.trainer.invalidTime);
    if (endsAt.getTime() <= startsAt.getTime()) return setError(t.trainer.invalidRange);
    setError(null);
    onSave({ startsAt, endsAt, reason: reason.trim() === '' ? null : reason.trim() });
  }

  return (
    <form className="form card" onSubmit={submit} aria-label={title}>
      <h3>{title}</h3>
      <div className="form-row">
        <label>
          {t.settings.fromDate}
          <input
            type="date"
            required
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label>
          {t.settings.fromTime}
          <input
            type="time"
            required
            value={fromTime}
            onChange={(e) => setFromTime(e.target.value)}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          {t.settings.toDate}
          <input type="date" required value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <label>
          {t.settings.toTime}
          <input type="time" required value={toTime} onChange={(e) => setToTime(e.target.value)} />
        </label>
      </div>
      <label>
        {t.settings.reason}
        <input autoComplete="off" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button" disabled={busy}>
          {t.settings.save}
        </button>
        {onCancel !== undefined && (
          <button type="button" className="button secondary" onClick={onCancel}>
            {t.settings.cancelEdit}
          </button>
        )}
      </div>
    </form>
  );
}
