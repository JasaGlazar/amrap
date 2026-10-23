import { useState, type FormEvent } from 'react';
import type { CustomerFields } from '../../data/customers';
import { t } from '../../i18n';

type Props = {
  title: string;
  submitLabel: string;
  initial: CustomerFields;
  busy: boolean;
  error: string | null;
  notice?: string | null;
  onSubmit: (fields: CustomerFields) => void;
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
  notice,
  onSubmit,
}: Props) {
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === '') return setInvalid(true);
    setInvalid(false);
    onSubmit({ name: name.trim(), phone: orNull(phone), email: orNull(email) });
  }

  return (
    <form className="form card" onSubmit={submit} aria-label={title}>
      <h2>{title}</h2>
      <label>
        {t.customers.name}
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        {t.customers.phone}
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label>
        {t.customers.email}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {invalid && (
        <p role="alert" className="error">
          {t.customers.nameRequired}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice !== undefined && notice !== null && (
        <p role="status" className="ok">
          {notice}
        </p>
      )}
      <button type="submit" className="button" disabled={busy}>
        {submitLabel}
      </button>
    </form>
  );
}
