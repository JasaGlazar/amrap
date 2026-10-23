import { useState, type FormEvent } from 'react';
import type { Customer } from '../../data/customers';
import { t } from '../../i18n';
import { zonedInstant, type LocalDate } from '../../lib/time';

type Props = {
  customers: Customer[];
  defaultDate: LocalDate;
  timeZone: string;
  disabled: boolean;
  onSubmit: (booking: { customerId: string; startsAt: Date; endsAt: Date }) => void;
};

export function AdHocForm({ customers, defaultDate, timeZone, disabled, onSubmit }: Props) {
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (customerId === '') return setError(t.trainer.missingCustomer);
    const startsAt = zonedInstant(date, start, timeZone);
    const endsAt = zonedInstant(date, end, timeZone);
    if (startsAt === null || endsAt === null) return setError(t.trainer.invalidTime);
    if (endsAt.getTime() <= startsAt.getTime()) return setError(t.trainer.invalidRange);
    setError(null);
    onSubmit({ customerId, startsAt, endsAt });
  }

  return (
    <form className="form card" onSubmit={submit} aria-label={t.trainer.adHocFormTitle}>
      <h2>{t.trainer.adHocFormTitle}</h2>
      <label>
        {t.trainer.customer}
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">{t.trainer.chooseCustomer}</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.trainer.date}
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="form-row">
        <label>
          {t.trainer.start}
          <input type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          {t.trainer.end}
          <input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" className="button" disabled={disabled}>
        {t.trainer.adHocSubmit}
      </button>
    </form>
  );
}
