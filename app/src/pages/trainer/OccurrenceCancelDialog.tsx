import { useId, useRef, useState } from 'react';
import type { Appointment } from '../../data/appointments';
import { cancelOccurrence } from '../../data/slots';
import type { WeekSlot } from '../../data/week';
import { fill, t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { formatLongDay, formatTime } from '../../lib/time';
import { useModal } from '../shared/modal';
import { ReasonField } from '../shared/ReasonField';

type Props = {
  slot: WeekSlot;
  appointments: Appointment[];
  names: Map<string, string>;
  timeZone: string;
  returnTo: () => HTMLElement | null;
  onClose: () => void;
  onCancelled: (count: number) => Promise<void>;
};

export function OccurrenceCancelDialog({
  slot,
  appointments,
  names,
  timeZone,
  returnTo,
  onClose,
  onCancelled,
}: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const charged = appointments.some((appointment) => appointment.status === 'charged');

  useModal(dialogRef, onClose, { returnTo });

  async function confirm() {
    setBusy(true);
    const result = await cancelOccurrence(supabase, {
      templateId: slot.templateId,
      startsAt: slot.startsAt,
      reason,
    });
    if (result.ok) {
      await onCancelled(result.data ?? 0);
      return;
    }
    setBusy(false);
    setError(result.message);
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
        <h2 id={titleId}>{t.occurrenceDialog.title}</h2>
        <p className="dialog-name">
          {fill(t.slot.when, {
            day: formatLongDay(slot.startsAt, timeZone),
            time: formatTime(slot.startsAt, timeZone),
          })}
        </p>
        {appointments.length === 0 ? (
          <p>{t.trainer.nobodyBooked}</p>
        ) : (
          <>
            <p>{fill(t.occurrenceDialog.booked, { count: appointments.length })}</p>
            <ul className="dialog-list">
              {appointments.map((appointment) => (
                <li key={appointment.id}>
                  {names.get(appointment.customerId) ?? t.trainer.unknownCustomer}
                  {appointment.status === 'charged' && (
                    <span className="tag status-charged">{t.trainer.chargedTag}</span>
                  )}
                </li>
              ))}
            </ul>
            {charged && <p className="notice late">{t.occurrenceDialog.refund}</p>}
            <p>{t.occurrenceDialog.notify}</p>
          </>
        )}
        <ReasonField value={reason} onChange={setReason} />
        <p className="detail">{t.occurrenceDialog.reopen}</p>
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
            {t.occurrenceDialog.confirm}
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            {t.cancelDialog.back}
          </button>
        </div>
      </div>
    </div>
  );
}
