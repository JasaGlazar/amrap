import { useId } from 'react';
import { t } from '../../i18n';
import { useInstall } from '../../install/useInstall';

export function InstallCard() {
  const { mode, cardShown, install, dismiss } = useInstall();
  const titleId = useId();
  if (!cardShown) return null;

  const steps =
    mode === 'ios'
      ? [t.install.iosShare, t.install.iosAdd, t.install.openFromHome]
      : mode === 'android-manual'
        ? [t.install.androidMenu, t.install.androidAdd, t.install.openFromHome]
        : [];

  return (
    <section className="card install-card" aria-labelledby={titleId}>
      <h2 id={titleId}>{t.install.title}</h2>
      <p>{t.install.why}</p>
      {mode === 'ios' && <p>{t.install.iosWhy}</p>}
      {steps.length > 0 && (
        <ol className="install-steps" aria-label={t.install.stepsLabel}>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {mode === 'ios' && <p className="detail">{t.install.iosOtherBrowsers}</p>}
      <div className="actions">
        {mode === 'prompt' && (
          <button type="button" className="button" onClick={() => void install()}>
            {t.install.install}
          </button>
        )}
        <button type="button" className="button secondary" onClick={dismiss}>
          {t.install.notNow}
        </button>
      </div>
    </section>
  );
}
