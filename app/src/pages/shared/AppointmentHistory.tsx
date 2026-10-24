import type { Appointment } from '../../data/appointments';
import { fill, t } from '../../i18n';
import { formatDate, formatTime } from '../../lib/time';
import type { RowRef } from './PagedList';

type Props = { appointments: Appointment[]; timeZone: string; rowRef: RowRef };

export function AppointmentHistory({ appointments, timeZone, rowRef }: Props) {
  if (appointments.length === 0) return <p>{t.history.noAppointments}</p>;
  return (
    <ul className="list">
      {appointments.map((appointment) => (
        <li key={appointment.id} ref={rowRef(appointment.id)} tabIndex={-1} className="row">
          <span className="row-stack">
            <span>
              {fill(t.slot.when, {
                day: formatDate(appointment.startsAt, timeZone),
                time: formatTime(appointment.startsAt, timeZone),
              })}
            </span>
            {appointment.cancelReason !== null && (
              <span className="detail">
                {fill(t.history.reason, { reason: appointment.cancelReason })}
              </span>
            )}
          </span>
          <span className={`tag status-${appointment.status}`}>
            {t.appointmentStatus[appointment.status]}
          </span>
        </li>
      ))}
    </ul>
  );
}
