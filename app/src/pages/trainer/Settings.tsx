import { NavLink, Outlet } from 'react-router';
import { t } from '../../i18n';

const tabs = [
  { to: 'urnik', label: t.settings.tabs.templates },
  { to: 'odpoved', label: t.settings.tabs.cutoff },
  { to: 'zaprto', label: t.settings.tabs.blocked },
  { to: 'obvestila', label: t.settings.tabs.notifications },
  { to: 'registracija', label: t.settings.tabs.registration },
];

export function TrainerSettings() {
  return (
    <>
      <h1>{t.trainer.settingsTitle}</h1>
      <nav className="tabs" aria-label={t.settings.sectionsLabel}>
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
