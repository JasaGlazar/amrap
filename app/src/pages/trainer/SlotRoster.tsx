import { useState } from 'react';
import type { Appointment } from '../../data/appointments';
import type { Customer } from '../../data/customers';
import { t } from '../../i18n';
import { OnDemand } from '../shared/OnDemand';

type Add = {
  label: string;
  customers: Customer[];
  open: boolean;
  unavailable: string | null;
  pending: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAdd: (id: string) => void;
};

type Props = {
  appointments: Appointment[];
  names: Map<string, string>;
  onCancel?: (appointment: Appointment) => void;
  add?: Add;
  onCancelOccurrence?: (opener: HTMLElement) => void;
};

function AddControl({ add, choices }: { add: Add; choices: Customer[] }) {
  const [chosen, setChosen] = useState('');
  return (
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
        disabled={add.pending || chosen === ''}
        onClick={() => add.onAdd(chosen)}
      >
        {t.trainer.add}
      </button>
      <button
        type="button"
        className="button secondary small"
        disabled={add.pending}
        onClick={add.onClose}
      >
        {t.common.cancel}
      </button>
    </div>
  );
}

export function SlotRoster({ appointments, names, onCancel, add, onCancelOccurrence }: Props) {
  const bookedIds = new Set(appointments.map((appointment) => appointment.customerId));
  const choices = add?.customers.filter((customer) => !bookedIds.has(customer.id)) ?? [];
  const reason = add?.unavailable ?? (choices.length === 0 ? t.trainer.noneToAdd : null);

  return (
    <div className="roster">
      {appointments.length === 0 ? (
        <p className="detail">{t.trainer.nobodyBooked}</p>
      ) : (
        <ul className="roster-list">
          {appointments.map((appointment) => (
            <li key={appointment.id}>
              <span>{names.get(appointment.customerId) ?? t.trainer.unknownCustomer}</span>
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
      {(add !== undefined || onCancelOccurrence !== undefined) && (
        <div className="roster-actions">
          {add !== undefined && (
            <OnDemand
              label={reason ?? t.trainer.addCustomer}
              className="button secondary small"
              add={reason === null}
              disabled={reason !== null || add.pending}
              open={add.open && reason === null}
              onOpen={add.onOpen}
            >
              <AddControl add={add} choices={choices} />
            </OnDemand>
          )}
          {onCancelOccurrence !== undefined && (
            <button
              type="button"
              className="button quiet"
              onClick={(event) => onCancelOccurrence(event.currentTarget)}
            >
              {t.trainer.cancelOccurrence}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
