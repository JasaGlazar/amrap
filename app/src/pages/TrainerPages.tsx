import { t } from '../i18n';
import { AppShell } from './AppShell';
import { PlaceholderPage } from './PlaceholderPage';

export function TrainerShell() {
  const items = [
    { to: '/t', label: t.nav.today, end: true },
    { to: '/t/koledar', label: t.nav.calendar },
    { to: '/t/stranke', label: t.nav.customers },
    { to: '/t/nastavitve', label: t.nav.settings },
  ];
  return <AppShell items={items} label={t.nav.trainerLabel} />;
}

export function TrainerSettings() {
  return <PlaceholderPage title={t.trainer.settingsTitle} />;
}
