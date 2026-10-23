import { t } from '../i18n';
import { AppShell } from './AppShell';

export function CustomerShell() {
  const items = [
    { to: '/c', label: t.nav.home, end: true },
    { to: '/c/koledar', label: t.nav.calendar },
    { to: '/c/zgodovina', label: t.nav.history },
  ];
  return <AppShell items={items} label={t.nav.customerLabel} audience="customer" />;
}
