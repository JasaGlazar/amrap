import { useState } from 'react';
import type { Appointment } from '../../data/appointments';
import type { Customer } from '../../data/customers';
import { t } from '../../i18n';

type Props = {
  appointments: Appointment[];
  names: Map<string, string>;
  onCancel?: (appointment: Appointment) => void;
  add?: { label: string; customers: Customer[]; disabled: boolean; onAdd: (id: string) => void };
};

export function SlotRoster({ appointments, names, onCancel, add }: Props) {
  const [chosen, setChosen] = useState('');
  const bookedIds = new Set(appointments.map((appointment) => appointment.customerId));
  const choices = add?.customers.filter((customer) => !bookedIds.has(customer.id)) ?? [];

  return (
    <div className="roster">
      {appointments.length === 0 ? (
        <p className="detail">{t.trainer.nobodyBooked}</p>
      ) : (
        <ul className="roster-list">
          {appointments.map((appointment) => (
            <li key={appointment.id}>
              <span>{names.get(appointment.customerId) ?? appointment.customerId}</span>
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
      {add !== undefined && (
        <div className="roster-add">
          <select aria-label={add.label} value={chosen} onChange={(e) => setChosen(e.target.value)}>
            <option value="">{t.trainer.chooseCustomer}</option>
            {choices.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button small"
            disabled={add.disabled || chosen === ''}
            onClick={() => {
              add.onAdd(chosen);
              setChosen('');
            }}
          >
            {t.trainer.add}
          </button>
        </div>
      )}
    </div>
  );
}
