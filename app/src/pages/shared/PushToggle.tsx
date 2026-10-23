import { useCallback, useState } from 'react';
import { hasPushSubscription } from '../../data/push';
import { t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { browserPlatform, type PushPlatform } from '../../push/browser';
import { disablePush, enablePush } from '../../push/subscribe';
import { pushSupport, type PushSupport } from '../../push/support';
import { NoticeLine, type Notice } from './NoticeLine';

type ToggleState = 'on' | 'off' | 'blocked' | Exclude<PushSupport, 'supported'>;

const stateText: Record<ToggleState, string> = {
  on: t.pushToggle.on,
  off: t.pushToggle.off,
  blocked: t.pushToggle.blocked,
  'needs-install': t.pushToggle.needsInstall,
  unsupported: t.pushToggle.unsupported,
  'no-key': t.pushToggle.noKey,
};

export function PushToggle({
  audience,
  userId,
  platform = browserPlatform,
}: {
  audience: 'customer' | 'trainer';
  userId: string;
  platform?: PushPlatform;
}) {
  const load = useCallback(async (): Promise<ToggleState> => {
    const support = pushSupport(platform.environment());
    if (support !== 'supported') return support;
    if (platform.permission() === 'denied') return 'blocked';
    const subscription = await platform.getSubscription();
    if (subscription === null || platform.permission() !== 'granted') return 'off';
    return (await hasPushSubscription(supabase, subscription.endpoint, userId)) ? 'on' : 'off';
  }, [platform, userId]);
  const [state, reload] = useLoad(load);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function toggle(enable: boolean) {
    setBusy(true);
    setNotice(null);
    const vapidKey = platform.environment().vapidKey ?? '';
    const result = enable
      ? await enablePush(supabase, platform, vapidKey)
      : await disablePush(supabase, platform, userId);
    setNotice(
      result.ok
        ? { error: false, text: enable ? t.pushToggle.enabled : t.pushToggle.disabled }
        : { error: true, text: result.message },
    );
    await reload();
    setBusy(false);
  }

  return (
    <section className="card" aria-label={t.pushToggle.title}>
      <h2>{t.pushToggle.title}</h2>
      <p className="label">
        {audience === 'customer' ? t.pushToggle.customerHint : t.pushToggle.trainerHint}
      </p>
      {state.status === 'loading' && <p className="status">{t.common.loading}</p>}
      {state.status === 'error' && (
        <p role="alert" className="error">
          {t.common.loadFailed}
        </p>
      )}
      {state.status === 'ok' && (
        <>
          <p>{stateText[state.data]}</p>
          {(state.data === 'on' || state.data === 'off') && (
            <button
              type="button"
              className={state.data === 'on' ? 'button secondary' : 'button'}
              disabled={busy}
              onClick={() => void toggle(state.data === 'off')}
            >
              {state.data === 'on' ? t.pushToggle.disable : t.pushToggle.enable}
            </button>
          )}
        </>
      )}
      <NoticeLine notice={notice} />
    </section>
  );
}
