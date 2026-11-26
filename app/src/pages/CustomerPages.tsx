import { t } from '../i18n';
import { AppShell } from './AppShell';

const items = [
  { to: '/c', label: t.nav.home, end: true },
  { to: '/c/koledar', label: t.nav.calendar },
  { to: '/c/zgodovina', label: t.nav.history },
];

export function CustomerShell() {
  return <AppShell items={items} label={t.nav.customerLabel} audience="customer" />;
}
