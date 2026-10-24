import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { chargedSince, upcomingAppointments, type Appointment } from '../../data/appointments';
import type { ActionResult } from '../../data/client';
import { adjust, balanceOf, ledgerOf, topUp } from '../../data/credits';
import { createInvite, getCustomer, inviteStatus, updateCustomer } from '../../data/customers';
import { activateRule, addRule, deactivateRule, rulesOf } from '../../data/rules';
import { getSettings } from '../../data/settings';
import { allTemplates } from '../../data/slots';
import { fill, formatBalance, t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { formatLongDay, formatTime, weekdayName } from '../../lib/time';
import { useLoad } from '../../lib/useLoad';
import { CancelDialog } from '../shared/CancelDialog';
import { LedgerList } from '../shared/LedgerList';
import { NoticeLine, type Notice } from '../shared/NoticeLine';
import { OnDemand } from '../shared/OnDemand';
import { PagedList, type RowRef } from '../shared/PagedList';
import { CustomerFieldsForm } from './CustomerFieldsForm';
import { RuleForm } from './RuleForm';

export const RECENT_DAYS = 30;

export function TrainerCustomerDetail() {
  const { id = '' } = useParams();
  const load = useCallback(async () => {
    const now = new Date();
    const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
    const [customer, settings, balance, ledger, upcoming, recent, rules, templates] =
      await Promise.all([
        getCustomer(supabase, id),
        getSettings(supabase),
        balanceOf(supabase, id),
        ledgerOf(supabase, id),
        upcomingAppointments(supabase, id, now),
        chargedSince(supabase, id, since),
        rulesOf(supabase, id),
        allTemplates(supabase),
      ]);
    return { now, since, customer, settings, balance, ledger, upcoming, recent, rules, templates };
  }, [id]);
  const [state, reload] = useLoad(load);
  const location = useLocation();
  const navigate = useNavigate();
  const starting = location.state as { startingError?: string; startingBalance?: number } | null;
  const startingError = starting?.startingError;
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Record<string, Notice>>((): Record<string, Notice> =>
    startingError === undefined
      ? {}
      : {
          credits: {
            error: true,
            text: fill(t.customerDetail.startingFailed, { error: startingError }),
          },
        },
  );
  const [amount, setAmount] = useState(() =>
    starting?.startingBalance === undefined ? '' : String(starting.startingBalance),
  );
  const [note, setNote] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [addingRule, setAddingRule] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [cancelling, setCancelling] = useState<{
    appointment: Appointment;
    section: string;
  } | null>(null);

  useEffect(() => {
    if (location.state !== null) void navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  async function run<T>(
    section: string,
    action: () => Promise<ActionResult<T>>,
    success: (data: T) => string,
  ): Promise<boolean> {
    setBusy(true);
    setNotices((current) => ({ ...current, [section]: null }));
    const result = await action();
    setNotices((current) => ({
      ...current,
      [section]: result.ok
        ? { error: false, text: success(result.data) }
        : { error: true, text: result.message },
    }));
    await reload();
    setBusy(false);
    return result.ok;
  }

  if (state.status === 'loading') return <p className="status">{t.common.loading}</p>;
  if (state.status === 'error') {
    return (
      <>
        <Link to="/t/stranke" className="back-link">
          {t.customerDetail.back}
        </Link>
        <p role="alert" className="error">
          {t.common.loadFailed}
        </p>
      </>
    );
  }

  const { now, since, customer, settings, balance, ledger, upcoming, recent, rules, templates } =
    state.data;
  const { timeZone } = settings;
  const status = inviteStatus(customer, now);
  const shownToken = inviteToken ?? (status === 'pending' ? customer.inviteToken : null);
  const inviteLink = shownToken === null ? null : `${window.location.origin}/invite/${shownToken}`;
  const templateLabel = (templateId: string) => {
    const template = templates.find((row) => row.id === templateId);
    if (template === undefined) return t.customerDetail.unknownTemplate;
    return fill(t.customerDetail.ruleLabel, {
      weekday: weekdayName(template.weekday),
      time: template.start_time.slice(0, 5),
    });
  };
  const noteShown = note ?? (ledger.rows.length === 0 ? t.customerDetail.startingNote : '');
  const ruleTemplates = new Set(rules.map((rule) => rule.slotTemplateId));
  const addableTemplates = templates.filter(
    (template) => template.active && !ruleTemplates.has(template.id),
  );

  async function copyLink(link: string) {
    let copied = false;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch (error) {
      console.warn('copy failed', error);
    }
    setNotices((current) => ({
      ...current,
      invite: copied
        ? { error: false, text: t.customerDetail.copied }
        : { error: true, text: t.customerDetail.copyFailed },
    }));
  }

  const appointmentSection = (section: string, title: string, content: ReactNode) => (
    <section aria-label={title}>
      <h2>{title}</h2>
      <NoticeLine notice={notices[section]} />
      {content}
    </section>
  );

  const appointmentList = (
    section: string,
    appointments: Appointment[],
    empty: string,
    actionLabel: string,
    rowRef?: RowRef,
  ) =>
    appointments.length === 0 ? (
      <p>{empty}</p>
    ) : (
      <ul className="list">
        {appointments.map((appointment) => (
          <li
            key={appointment.id}
            ref={rowRef?.(appointment.id)}
            tabIndex={rowRef === undefined ? undefined : -1}
            className="row"
          >
            <span>
              {fill(t.slot.when, {
                day: formatLongDay(appointment.startsAt, timeZone),
                time: formatTime(appointment.startsAt, timeZone),
              })}
            </span>
            <button
              type="button"
              className="button secondary small"
              onClick={() => setCancelling({ appointment, section })}
            >
              {actionLabel}
            </button>
          </li>
        ))}
      </ul>
    );

  async function changeCredits(kind: 'topUp' | 'adjust') {
    const value = Number(amount);
    const valid = Number.isInteger(value) && (kind === 'topUp' ? value > 0 : value !== 0);
    if (amount.trim() === '' || !valid) {
      setNotices((current) => ({
        ...current,
        credits: {
          error: true,
          text: kind === 'topUp' ? t.customerDetail.topUpInvalid : t.customerDetail.adjustInvalid,
        },
      }));
      return;
    }
    const noteValue = noteShown.trim() === '' ? null : noteShown.trim();
    const ok = await run(
      'credits',
      () => (kind === 'topUp' ? topUp : adjust)(supabase, customer.id, value, noteValue),
      () => t.customerDetail.creditsSaved,
    );
    if (ok) {
      setAmount('');
      setNote(null);
    }
  }

  return (
    <>
      <Link to="/t/stranke" className="back-link">
        {t.customerDetail.back}
      </Link>
      <h1>{customer.name}</h1>
      <div className="summary">
        <section aria-label={t.customer.balanceLabel}>
          <p className="label-row">
            <span className="label">{t.customer.balanceLabel}</span>
            <span className="tag">{t.customers.inviteStatus[status]}</span>
          </p>
          <p className="balance-row">
            <span className={balance < 0 ? 'balance negative' : 'balance'}>
              {formatBalance(balance)}
            </span>
            {balance < 0 && <span className="tag late">{t.customer.debt}</span>}
          </p>
        </section>
        <section className="form card" aria-label={t.customerDetail.creditsTitle}>
          <h2>{t.customerDetail.creditsTitle}</h2>
          <label>
            {t.customerDetail.amount}
            <input
              type="number"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            {t.customerDetail.note}
            <input autoComplete="off" value={noteShown} onChange={(e) => setNote(e.target.value)} />
          </label>
          <NoticeLine notice={notices.credits} />
          <div className="actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void changeCredits('topUp')}
            >
              {t.customerDetail.topUp}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void changeCredits('adjust')}
            >
              {t.customerDetail.adjust}
            </button>
          </div>
        </section>
      </div>
      {appointmentSection(
        'upcoming',
        t.customerDetail.upcomingTitle,
        appointmentList('upcoming', upcoming, t.customer.noUpcoming, t.slot.cancel),
      )}
      <section aria-label={t.customerDetail.rulesTitle}>
        <div className="head">
          <h2>{t.customerDetail.rulesTitle}</h2>
          <OnDemand
            label={t.customerDetail.addRule}
            className="button secondary"
            add
            open={addingRule}
            onOpen={() => setAddingRule(true)}
          >
            <RuleForm
              options={addableTemplates.map((template) => ({
                id: template.id,
                label: templateLabel(template.id),
              }))}
              busy={busy}
              onSubmit={(templateId) =>
                void run(
                  'rules',
                  () => addRule(supabase, customer.id, templateId),
                  (count) => fill(t.customerDetail.ruleStarted, { count: count ?? 0 }),
                ).then((ok) => ok && setAddingRule(false))
              }
              onCancel={() => setAddingRule(false)}
            />
          </OnDemand>
        </div>
        <NoticeLine notice={notices.rules} />
        {rules.length === 0 ? (
          <p>{t.customerDetail.noRules}</p>
        ) : (
          <ul className="list">
            {rules.map((rule) => (
              <li key={rule.id} className={rule.active ? 'row' : 'row muted'}>
                <span className="row-text">
                  <span>{templateLabel(rule.slotTemplateId)}</span>
                  {!rule.active && <span className="tag">{t.customerDetail.ruleInactive}</span>}
                </span>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={busy}
                  onClick={() =>
                    void (rule.active
                      ? run(
                          'rules',
                          () => deactivateRule(supabase, rule.id),
                          (count) => fill(t.customerDetail.ruleStopped, { count: count ?? 0 }),
                        )
                      : run(
                          'rules',
                          () => activateRule(supabase, rule.id),
                          (count) => fill(t.customerDetail.ruleStarted, { count: count ?? 0 }),
                        ))
                  }
                >
                  {rule.active ? t.customerDetail.stopRule : t.customerDetail.restartRule}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {appointmentSection(
        'recent',
        fill(t.customerDetail.recentTitle, { days: RECENT_DAYS }),
        <PagedList first={recent} fetchPage={(from) => chargedSince(supabase, id, since, from)}>
          {(rows, rowRef) =>
            appointmentList(
              'recent',
              rows,
              t.customerDetail.noRecent,
              t.customerDetail.refund,
              rowRef,
            )
          }
        </PagedList>,
      )}
      <section aria-label={t.customerDetail.ledgerTitle}>
        <h2>{t.customerDetail.ledgerTitle}</h2>
        <PagedList first={ledger} fetchPage={(from) => ledgerOf(supabase, id, from)}>
          {(rows, rowRef) => <LedgerList ledger={rows} timeZone={timeZone} rowRef={rowRef} />}
        </PagedList>
      </section>
      <section className="card" aria-label={t.customerDetail.inviteTitle}>
        <h2>{t.customerDetail.inviteTitle}</h2>
        {customer.linked ? (
          <p>{t.customerDetail.relinkHint}</p>
        ) : (
          <>
            {inviteLink !== null && (
              <div className="form">
                <label>
                  {t.customerDetail.inviteLink}
                  <input readOnly value={inviteLink} onFocus={(e) => e.target.select()} />
                </label>
                <p className="detail">{t.customerDetail.inviteHint}</p>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void copyLink(inviteLink)}
                >
                  {t.customerDetail.copy}
                </button>
              </div>
            )}
            <NoticeLine notice={notices.invite} />
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void run(
                  'invite',
                  async () => {
                    const result = await createInvite(supabase, customer.id);
                    if (result.ok) setInviteToken(result.data);
                    return result;
                  },
                  () => t.customerDetail.inviteCreated,
                )
              }
            >
              {inviteLink === null ? t.customerDetail.createInvite : t.customerDetail.newInvite}
            </button>
          </>
        )}
      </section>
      <section aria-label={t.customerDetail.detailsTitle}>
        <div className="head">
          <h2>{t.customerDetail.detailsTitle}</h2>
          <OnDemand
            label={t.customerDetail.editDetails}
            className="button secondary"
            open={editingDetails}
            onOpen={() => {
              setNotices((current) => ({ ...current, details: null }));
              setEditingDetails(true);
            }}
          >
            <CustomerFieldsForm
              title={t.customerDetail.editDetails}
              heading="h3"
              submitLabel={t.customerDetail.save}
              initial={customer}
              busy={busy}
              error={notices.details?.error ? notices.details.text : null}
              onSubmit={(fields) =>
                void run(
                  'details',
                  () => updateCustomer(supabase, customer.id, fields),
                  () => t.customerDetail.saved,
                ).then((ok) => ok && setEditingDetails(false))
              }
              onCancel={() => {
                setNotices((current) => ({ ...current, details: null }));
                setEditingDetails(false);
              }}
            />
          </OnDemand>
        </div>
        <NoticeLine notice={notices.details?.error ? null : notices.details} />
        <dl className="facts">
          <div>
            <dt>{t.customers.phone}</dt>
            <dd>{customer.phone ?? t.customerDetail.notGiven}</dd>
          </div>
          <div>
            <dt>{t.customers.email}</dt>
            <dd>{customer.email ?? t.customerDetail.notGiven}</dd>
          </div>
        </dl>
      </section>

      {cancelling !== null && (
        <CancelDialog
          appointment={cancelling.appointment}
          settings={settings}
          customerName={customer.name}
          asTrainer
          onClose={() => {
            setCancelling(null);
            void reload();
          }}
          onCancelled={() => {
            setCancelling(null);
            setNotices((current) => ({
              ...current,
              [cancelling.section]: { error: false, text: t.cancelDialog.done },
            }));
            void reload();
          }}
        />
      )}
    </>
  );
}
