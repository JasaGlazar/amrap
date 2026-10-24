import { useEffect, useRef, type RefObject } from 'react';

const focusable =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)';

function keepFocusInside(dialog: HTMLElement, event: KeyboardEvent) {
  const items = [...dialog.querySelectorAll<HTMLElement>(focusable)];
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!dialog.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && (active === first || active === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function useModal(
  dialog: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: { focusFirst?: boolean; returnTo?: () => HTMLElement | null } = {},
) {
  const opening = useRef(options);

  useEffect(() => {
    const { focusFirst = false, returnTo } = opening.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    const first = focusFirst ? dialog.current?.querySelector<HTMLElement>(focusable) : null;
    (first ?? dialog.current)?.focus();
    return () => {
      root.style.overflow = overflow;
      const target = opener?.isConnected ? opener : (returnTo?.() ?? null);
      target?.focus();
    };
  }, [dialog]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && dialog.current) keepFocusInside(dialog.current, event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialog, onClose]);
}
