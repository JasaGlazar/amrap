import { useCallback, useId, useRef, useState } from 'react';
import {
  Link,
  NavigationType,
  useLocation,
  useNavigate,
  useNavigationType,
  useSearchParams,
} from 'react-router';
import { adjust, allBalances, topUp } from '../../data/credits';
import {
  createCustomer,
  inviteStatus,
  isNewCustomer,
  listCustomers,
  type CustomerFields,
} from '../../data/customers';
import { fill, plural, t } from '../../i18n';
import {
  customerFilterOf,
  customerFilters,
  searchCustomers,
  type CustomerFilter,
  type SearchableCustomer,
} from '../../lib/customerSearch';
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
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const searchId = useId();
  const searchField = useRef<HTMLInputElement>(null);
  const urlQuery = params.get('q') ?? '';
  const filter = customerFilterOf(params.get('f'));
  const [query, setQuery] = useState(urlQuery);
  const [seenKey, setSeenKey] = useState(location.key);
  if (location.key !== seenKey) {
    setSeenKey(location.key);
    const typed = (location.state as { fromSearch?: boolean } | null)?.fromSearch === true;
    if (navigationType !== NavigationType.Replace || !typed) {
      setQuery(urlQuery);
    }
  }

  function show(next: { q?: string; f?: CustomerFilter }) {
    if (next.q !== undefined) setQuery(next.q);
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        const q = next.q ?? query;
        const f = next.f ?? filter;
        if (q === '') updated.delete('q');
        else updated.set('q', q);
        if (f === 'vsi') updated.delete('f');
        else updated.set('f', f);
        return updated;
      },
      { replace: true, state: { fromSearch: true } },
    );
  }

  function clearSearch() {
    show({ q: '', f: 'vsi' });
    searchField.current?.focus();
  }

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
        <>
          <div role="search" className="customer-search">
            <label htmlFor={searchId}>{t.customers.search}</label>
            <input
              ref={searchField}
              id={searchId}
              type="search"
              autoComplete="off"
              enterKeyHint="search"
              placeholder={t.customers.searchPlaceholder}
              value={query}
              onChange={(event) => show({ q: event.target.value })}
            />
            <div className="segmented" role="group" aria-label={t.customers.filterLabel}>
              {customerFilters.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={filter === option}
                  onClick={() => show({ f: option })}
                >
                  {t.customers.filters[option]}
                </button>
              ))}
            </div>
          </div>
          <CustomerList
            customers={state.data.customers.map((customer) => ({
              ...customer,
              balance: state.data.balances.get(customer.id) ?? 0,
            }))}
            query={query}
            filter={filter}
            now={state.data.now}
            listSearch={location.search}
            onClear={clearSearch}
          />
        </>
      )}
    </>
  );
}

function CustomerList({
  customers,
  query,
  filter,
  now,
  listSearch,
  onClear,
}: {
  customers: SearchableCustomer[];
  query: string;
  filter: CustomerFilter;
  now: Date;
  listSearch: string;
  onClear: () => void;
}) {
  const shown = searchCustomers(customers, query, filter);
  const narrowed = query.trim() !== '' || filter !== 'vsi';
  return (
    <section aria-label={t.customers.listTitle}>
      {customers.length === 0 ? (
        <p>{t.customers.noCustomers}</p>
      ) : (
        <>
          <p role="status" className={shown.length === 0 ? undefined : 'count'}>
            {shown.length === 0
              ? t.customers.noMatches
              : narrowed
                ? fill(plural(t.customers.shown, shown.length), { total: customers.length })
                : plural(t.customers.total, customers.length)}
          </p>
          {shown.length === 0 ? (
            <button type="button" className="button secondary" onClick={onClear}>
              {t.customers.clearSearch}
            </button>
          ) : (
            <ul className="list">
              {shown.map((customer) => {
                const status = inviteStatus(customer, now);
                return (
                  <li key={customer.id} className="row">
                    <Link
                      to={`/t/stranke/${customer.id}`}
                      state={{ listSearch }}
                      className="row-link"
                    >
                      {customer.name}
                    </Link>
                    {isNewCustomer(customer) && <span className="tag">{t.customers.newTag}</span>}
                    {status !== 'linked' && (
                      <span className="tag">{t.customers.inviteStatus[status]}</span>
                    )}
                    <Amount value={customer.balance} />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
