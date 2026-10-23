import { t } from '../i18n';
import { AppShell } from './AppShell';
import { PlaceholderPage } from './PlaceholderPage';

export function TrainerShell() {
  const items = [
    { to: '/t', label: t.nav.today, end: true },
    { to: '/t/calendar', label: t.nav.calendar },
    { to: '/t/customers', label: t.nav.customers },
    { to: '/t/settings', label: t.nav.settings },
  ];
  return <AppShell items={items} label={t.nav.trainerLabel} />;
}

export function TrainerToday() {
  return <PlaceholderPage title={t.trainer.todayTitle} />;
}

export function TrainerCalendar() {
  return <PlaceholderPage title={t.trainer.calendarTitle} />;
}

export function TrainerCustomers() {
  return <PlaceholderPage title={t.trainer.customersTitle} />;
}

export function TrainerSettings() {
  return <PlaceholderPage title={t.trainer.settingsTitle} />;
}
