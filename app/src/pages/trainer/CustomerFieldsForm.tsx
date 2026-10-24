import { useId, useRef, useState, type FormEvent } from 'react';
import type { CustomerFields } from '../../data/customers';
import { t } from '../../i18n';

type Props = {
  title: string;
  submitLabel: string;
  initial: CustomerFields;
  busy: boolean;
  error: string | null;
  heading?: 'h2' | 'h3';
  withStartingBalance?: boolean;
  onSubmit: (fields: CustomerFields, startingBalance: number | null) => void;
  onCancel?: () => void;
};

function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function CustomerFieldsForm({
  title,
  submitLabel,
  initial,
  busy,
  error,
  heading: Heading = 'h2',
  withStartingBalance = false,
  onSubmit,
  onCancel,
}: Props) {
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const [starting, setStarting] = useState('');
  const startingHintId = useId();
  const startingInput = useRef<HTMLInputElement>(null);
  const [invalid, setInvalid] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === '') return setInvalid(t.customers.nameRequired);
    const startingBalance = starting.trim() === '' ? null : Number(starting);
    const unreadable = startingInput.current?.validity.badInput === true;
    if (unreadable || (startingBalance !== null && !Number.isInteger(startingBalance))) {
      return setInvalid(t.customers.startingInvalid);
    }
    setInvalid(null);
    onSubmit({ name: name.trim(), phone: orNull(phone), email: orNull(email) }, startingBalance);
  }

  return (
    <form className="form card" onSubmit={submit} aria-label={title}>
      <Heading>{title}</Heading>
      <label>
        {t.customers.name}
        <input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        {t.customers.phone}
        <input
          type="tel"
          autoComplete="off"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      <label>
        {t.customers.email}
        <input
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {withStartingBalance && (
        <div>
          <label>
            {t.customers.startingBalance}
            <input
              type="number"
              step="1"
              autoComplete="off"
              ref={startingInput}
              aria-describedby={startingHintId}
              value={starting}
              onChange={(e) => setStarting(e.target.value)}
            />
          </label>
          <p id={startingHintId} className="detail">
            {t.customers.startingHint}
          </p>
        </div>
      )}
      {invalid !== null && (
        <p role="alert" className="error">
          {invalid}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button" disabled={busy}>
          {submitLabel}
        </button>
        {onCancel !== undefined && (
          <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>
            {t.common.cancel}
          </button>
        )}
      </div>
    </form>
  );
}
