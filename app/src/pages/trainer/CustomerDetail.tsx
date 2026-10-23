import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import { chargedSince, upcomingAppointments, type Appointment } from '../../data/appointments';
import type { ActionResult } from '../../data/client';
import { adjust, balanceOf, ledgerOf, topUp } from '../../data/credits';
import { createInvite, getCustomer, inviteStatus, updateCustomer } from '../../data/customers';
import { activateRule, addRule, deactivateRule, rulesOf } from '../../data/rules';
import { getSettings } from '../../data/settings';
import { allTemplates } from '../../data/slots';
import { fill, t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { formatLongDay, formatTime, weekdayName } from '../../lib/time';
import { useLoad } from '../../lib/useLoad';
import { CancelDialog } from '../shared/CancelDialog';
import { LedgerList } from '../shared/LedgerList';
import { NoticeLine, type Notice } from '../shared/NoticeLine';
import { CustomerFieldsForm } from './CustomerFieldsForm';

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
    return { now, customer, settings, balance, ledger, upcoming, recent, rules, templates };
  }, [id]);
  const [state, reload] = useLoad(load);
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [chosenTemplate, setChosenTemplate] = useState('');
  const [cancelling, setCancelling] = useState<{
    appointment: Appointment;
    section: string;
  } | null>(null);

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
        <Link to="/t/stranke">{t.customerDetail.back}</Link>
        <p role="alert" className="error">
          {t.common.loadFailed}
        </p>
      </>
    );
  }

  const { now, customer, settings, balance, ledger, upcoming, recent, rules, templates } =
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

  const appointmentSection = (
    section: string,
    title: string,
    appointments: Appointment[],
    empty: string,
  ) => (
    <section aria-label={title}>
      <h2>{title}</h2>
      <NoticeLine notice={notices[section]} />
      {appointments.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <ul className="list">
          {appointments.map((appointment) => (
            <li key={appointment.id} className="row">
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
                {t.slot.cancel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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
    const noteValue = note.trim() === '' ? null : note.trim();
    const ok = await run(
      'credits',
      () => (kind === 'topUp' ? topUp : adjust)(supabase, customer.id, value, noteValue),
      () => t.customerDetail.creditsSaved,
    );
    if (ok) {
      setAmount('');
      setNote('');
    }
  }

  return (
    <>
      <Link to="/t/stranke">{t.customerDetail.back}</Link>
      <h1>{customer.name}</h1>
      <section className="card">
        <p className="label">{t.customer.balanceLabel}</p>
        <p className="balance-row">
          <span className={balance < 0 ? 'balance negative' : 'balance'}>{balance}</span>
          {balance < 0 && <span className="tag late">{t.customer.debt}</span>}
          <span className="tag">{t.customers.inviteStatus[status]}</span>
        </p>
      </section>

      <section className="form card" aria-label={t.customerDetail.creditsTitle}>
        <h2>{t.customerDetail.creditsTitle}</h2>
        <label>
          {t.customerDetail.amount}
          <input
            type="number"
            inputMode="numeric"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          {t.customerDetail.note}
          <input value={note} onChange={(e) => setNote(e.target.value)} />
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

      <section aria-label={t.customerDetail.rulesTitle}>
        <h2>{t.customerDetail.rulesTitle}</h2>
        <NoticeLine notice={notices.rules} />
        {rules.length === 0 ? (
          <p>{t.customerDetail.noRules}</p>
        ) : (
          <ul className="list">
            {rules.map((rule) => (
              <li key={rule.id} className={rule.active ? 'row' : 'row muted'}>
                <span>{templateLabel(rule.slotTemplateId)}</span>
                {!rule.active && <span className="tag">{t.customerDetail.ruleInactive}</span>}
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
        <div className="roster-add">
          <select
            aria-label={t.customerDetail.addRuleLabel}
            value={chosenTemplate}
            onChange={(e) => setChosenTemplate(e.target.value)}
          >
            <option value="">{t.customerDetail.chooseTemplate}</option>
            {addableTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {templateLabel(template.id)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button small"
            disabled={busy || chosenTemplate === ''}
            onClick={() => {
              const templateId = chosenTemplate;
              setChosenTemplate('');
              void run(
                'rules',
                () => addRule(supabase, customer.id, templateId),
                (count) => fill(t.customerDetail.ruleStarted, { count: count ?? 0 }),
              );
            }}
          >
            {t.customerDetail.addRule}
          </button>
        </div>
      </section>

      {appointmentSection(
        'upcoming',
        t.customerDetail.upcomingTitle,
        upcoming,
        t.customer.noUpcoming,
      )}
      {appointmentSection(
        'recent',
        fill(t.customerDetail.recentTitle, { days: RECENT_DAYS }),
        recent,
        t.customerDetail.noRecent,
      )}

      <CustomerFieldsForm
        key={`${customer.name}|${customer.phone}|${customer.email}`}
        title={t.customerDetail.detailsTitle}
        submitLabel={t.customerDetail.save}
        initial={customer}
        busy={busy}
        error={notices.details?.error ? notices.details.text : null}
        notice={notices.details && !notices.details.error ? notices.details.text : null}
        onSubmit={(fields) =>
          void run(
            'details',
            () => updateCustomer(supabase, customer.id, fields),
            () => t.customerDetail.saved,
          )
        }
      />

      <section aria-label={t.customerDetail.ledgerTitle}>
        <h2>{t.customerDetail.ledgerTitle}</h2>
        <LedgerList ledger={ledger} timeZone={timeZone} />
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
