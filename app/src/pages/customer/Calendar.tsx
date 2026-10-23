import { useCallback, useState } from 'react';
import { useCustomer } from '../../auth/AuthContext';
import { book, type Appointment } from '../../data/appointments';
import { appointmentsIn, loadWeek, type WeekSlot } from '../../data/week';
import { t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { CancelDialog } from '../shared/CancelDialog';
import { NoticeLine, type Notice } from '../shared/NoticeLine';
import { WeekNav } from '../shared/WeekNav';
import { WeekSlots } from '../shared/WeekSlots';

export function CustomerCalendar() {
  const customer = useCustomer();
  const [weekOffset, setWeekOffset] = useState(0);
  const load = useCallback(
    () => loadWeek(supabase, { now: new Date(), weekOffset, customerId: customer.id }),
    [customer.id, weekOffset],
  );
  const [state, reload] = useLoad(load);
  const [message, setMessage] = useState<Notice>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);

  async function bookSlot(slot: WeekSlot) {
    setPending(slot.key);
    setMessage(null);
    const result = await book(supabase, {
      customerId: customer.id,
      startsAt: slot.startsAt,
      slotTemplateId: slot.templateId,
    });
    setMessage(
      result.ok ? { error: false, text: t.calendar.booked } : { error: true, text: result.message },
    );
    await reload();
    setPending(null);
  }

  function goToWeek(offset: number) {
    setMessage(null);
    setWeekOffset(offset);
  }

  return (
    <>
      <h1>{t.customer.calendarTitle}</h1>
      <WeekNav
        start={state.status === 'ok' ? state.data.start : null}
        canGoBack={weekOffset > 0}
        onPrevious={() => goToWeek(weekOffset - 1)}
        onNext={() => goToWeek(weekOffset + 1)}
      />
      <NoticeLine notice={message} />
      {state.status === 'loading' && <p className="status">{t.common.loading}</p>}
      {state.status === 'error' && (
        <p role="alert" className="error">
          {t.common.loadFailed}
        </p>
      )}
      {state.status === 'ok' && (
        <WeekSlots
          slots={state.data.slots}
          timeZone={state.data.settings.timeZone}
          actions={(slot) => {
            const mine = appointmentsIn(state.data, slot)[0];
            if (mine !== undefined) {
              return (
                <span className="slot-mine">
                  <span className="tag">{t.calendar.mine}</span>
                  {mine.status === 'booked' && !slot.past && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => setCancelling(mine)}
                    >
                      {t.slot.cancel}
                    </button>
                  )}
                </span>
              );
            }
            const full = slot.free === 0;
            return (
              <button
                type="button"
                className="button small"
                disabled={full || slot.past || slot.blocked || pending !== null}
                onClick={() => void bookSlot(slot)}
              >
                {full ? t.calendar.full : t.calendar.book}
              </button>
            );
          }}
        />
      )}
      {cancelling !== null && state.status === 'ok' && (
        <CancelDialog
          appointment={cancelling}
          settings={state.data.settings}
          onClose={() => {
            setCancelling(null);
            void reload();
          }}
          onCancelled={() => {
            setCancelling(null);
            setMessage({ error: false, text: t.cancelDialog.done });
            void reload();
          }}
        />
      )}
    </>
  );
}
