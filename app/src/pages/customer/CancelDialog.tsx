import { useEffect, useId, useRef, useState } from 'react';
import { cancel } from '../../data/appointments';
import type { GymSettings } from '../../data/settings';
import { fill, t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { cutoffOf, formatDay, formatLongDay, formatTime, isFreeCancel } from '../../lib/time';

type Props = {
  appointment: { id: string; startsAt: Date };
  settings: GymSettings;
  onClose: () => void;
  onCancelled: () => void;
};

export function CancelDialog({ appointment, settings, onClose, onCancelled }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const { startsAt } = appointment;
  const { lateCancelHours, timeZone } = settings;
  const [free, setFree] = useState(() => isFreeCancel(startsAt, lateCancelHours, new Date()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cutoff = cutoffOf(startsAt, lateCancelHours);

  useEffect(() => dialogRef.current?.focus(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function confirm() {
    const freeNow = isFreeCancel(startsAt, lateCancelHours, new Date());
    if (freeNow !== free) {
      setFree(freeNow);
      return;
    }
    setBusy(true);
    const result = await cancel(supabase, appointment.id);
    setBusy(false);
    if (result.ok) onCancelled();
    else setError(result.message);
  }

  return (
    <div className="overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="dialog"
      >
        <h2 id={titleId}>{t.cancelDialog.title}</h2>
        <p>
          {fill(t.slot.when, {
            day: formatLongDay(startsAt, timeZone),
            time: formatTime(startsAt, timeZone),
          })}
        </p>
        <p>
          {fill(t.cancelDialog.cutoff, {
            day: formatDay(cutoff, timeZone),
            time: formatTime(cutoff, timeZone),
          })}
        </p>
        <p className={free ? 'notice' : 'notice late'}>
          {free ? t.cancelDialog.free : t.cancelDialog.late}
        </p>
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            className="button danger"
            disabled={busy || error !== null}
            onClick={() => void confirm()}
          >
            {t.cancelDialog.confirm}
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            {t.cancelDialog.back}
          </button>
        </div>
      </div>
    </div>
  );
}
