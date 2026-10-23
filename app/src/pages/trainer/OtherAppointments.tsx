import type { Appointment } from '../../data/appointments';
import { fill, t } from '../../i18n';
import { formatLongDay, formatTime } from '../../lib/time';

type Props = {
  appointments: Appointment[];
  names: Map<string, string>;
  timeZone: string;
  onCancel?: (appointment: Appointment) => void;
};

export function OtherAppointments({ appointments, names, timeZone, onCancel }: Props) {
  return (
    <section aria-label={t.trainer.otherTitle}>
      <h2>{t.trainer.otherTitle}</h2>
      {appointments.length === 0 ? (
        <p>{t.trainer.noOther}</p>
      ) : (
        <ul className="list">
          {appointments.map((appointment) => (
            <li key={appointment.id} className="row slot">
              <span className="ledger-main">
                <span>
                  {fill(t.slot.when, {
                    day: formatLongDay(appointment.startsAt, timeZone),
                    time: fill(t.trainer.timeRange, {
                      from: formatTime(appointment.startsAt, timeZone),
                      to: formatTime(appointment.endsAt, timeZone),
                    }),
                  })}
                </span>
                <span>{names.get(appointment.customerId) ?? t.trainer.unknownCustomer}</span>
              </span>
              <span className={appointment.slotTemplateId === null ? 'tag' : 'tag late'}>
                {appointment.slotTemplateId === null ? t.trainer.adHocTag : t.trainer.offGridTag}
              </span>
              {appointment.status === 'charged' && (
                <span className="tag status-charged">{t.trainer.chargedTag}</span>
              )}
              {onCancel !== undefined && (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => onCancel(appointment)}
                >
                  {t.slot.cancel}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
