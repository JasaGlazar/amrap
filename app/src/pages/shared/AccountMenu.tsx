import { useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import { Link } from 'react-router';
import { t } from '../../i18n';
import type { StorageAccess } from '../../install/flags';
import { applyTheme, readTheme, saveTheme, themes, type Theme } from '../../theme/theme';

const browserStorage: StorageAccess = () => window.localStorage;

export function AccountMenu({ storage = browserStorage }: { storage?: StorageAccess }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readTheme(storage));
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  function onBlur(event: FocusEvent) {
    if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  }

  function choose(next: Theme) {
    setTheme(next);
    saveTheme(storage, next);
    applyTheme(document, next);
  }

  return (
    <div className="account" ref={root} onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className="account-button"
        aria-label={t.account.menu}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
        </svg>
      </button>
      {open && (
        <div id={id} ref={panel} className="account-menu" tabIndex={-1}>
          <fieldset>
            <legend>{t.account.appearance}</legend>
            {themes.map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name={`${id}-theme`}
                  value={option}
                  checked={theme === option}
                  onChange={() => choose(option)}
                />
                {t.account.theme[option]}
              </label>
            ))}
          </fieldset>
          <Link to="/logout">{t.common.signOut}</Link>
        </div>
      )}
    </div>
  );
}
