import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { adjust, allBalances, topUp } from '../../data/credits';
import {
  createCustomer,
  inviteStatus,
  listCustomers,
  type CustomerFields,
} from '../../data/customers';
import { t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { Amount } from '../shared/Amount';
import { OnDemand } from '../shared/OnDemand';
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
  const [adding, setAdding] = useState(false);

  async function create(draft: CustomerFields, startingBalance: number | null) {
    setBusy(true);
    const result = await createCustomer(supabase, draft);
    if (!result.ok || result.data === null) {
      setBusy(false);
      return setError(result.ok ? null : result.message);
    }
    const { id } = result.data;
    let startingError: string | null = null;
    if (startingBalance !== null && startingBalance !== 0) {
      const record = startingBalance > 0 ? topUp : adjust;
      const credit = await record(supabase, id, startingBalance, t.customerDetail.startingNote);
      if (!credit.ok) startingError = credit.message;
    }
    setBusy(false);
    void navigate(`/t/stranke/${id}`, {
      state: startingError === null ? null : { startingError, startingBalance },
    });
  }

  return (
    <>
      <div className="head">
        <h1>{t.trainer.customersTitle}</h1>
        <OnDemand
          label={t.customers.newTitle}
          add
          open={adding}
          onOpen={() => {
            setError(null);
            setAdding(true);
          }}
        >
          <CustomerFieldsForm
            title={t.customers.newTitle}
            submitLabel={t.customers.create}
            initial={{ name: '', phone: null, email: null }}
            busy={busy}
            error={error}
            withStartingBalance
            onSubmit={(draft, startingBalance) => void create(draft, startingBalance)}
            onCancel={() => setAdding(false)}
          />
        </OnDemand>
      </div>
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
                const status = inviteStatus(customer, state.data.now);
                return (
                  <li key={customer.id} className="row">
                    <Link to={`/t/stranke/${customer.id}`} className="row-link">
                      {customer.name}
                    </Link>
                    {status !== 'linked' && (
                      <span className="tag">{t.customers.inviteStatus[status]}</span>
                    )}
                    <Amount value={state.data.balances.get(customer.id) ?? 0} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
