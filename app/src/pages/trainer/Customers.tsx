import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { allBalances } from '../../data/credits';
import {
  createCustomer,
  inviteStatus,
  listCustomers,
  type CustomerFields,
} from '../../data/customers';
import { t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { CustomerFieldsForm } from './CustomerFieldsForm';

export function TrainerCustomers() {
  const navigate = useNavigate();
  const load = useCallback(async () => {
    const [customers, balances] = await Promise.all([
      listCustomers(supabase),
      allBalances(supabase),
    ]);
    return { customers, balances, now: new Date() };
  }, []);
  const [state] = useLoad(load);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(draft: CustomerFields) {
    setBusy(true);
    const result = await createCustomer(supabase, draft);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    if (result.data !== null) void navigate(`/t/stranke/${result.data.id}`);
  }

  return (
    <>
      <h1>{t.trainer.customersTitle}</h1>
      {state.status === 'loading' && <p className="status">{t.common.loading}</p>}
      {state.status === 'error' && (
        <p role="alert" className="error">
          {t.common.loadFailed}
        </p>
      )}
      {state.status === 'ok' && (
        <section aria-label={t.customers.listTitle}>
          {state.data.customers.length === 0 ? (
            <p>{t.customers.noCustomers}</p>
          ) : (
            <ul className="list">
              {state.data.customers.map((customer) => {
                const balance = state.data.balances.get(customer.id) ?? 0;
                return (
                  <li key={customer.id} className="row">
                    <Link to={`/t/stranke/${customer.id}`} className="row-link">
                      {customer.name}
                    </Link>
                    <span className="tag">
                      {t.customers.inviteStatus[inviteStatus(customer, state.data.now)]}
                    </span>
                    <span className={balance < 0 ? 'amount negative' : 'amount'}>{balance}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      <CustomerFieldsForm
        title={t.customers.newTitle}
        submitLabel={t.customers.create}
        initial={{ name: '', phone: null, email: null }}
        busy={busy}
        error={error}
        onSubmit={(draft) => void create(draft)}
      />
    </>
  );
}
