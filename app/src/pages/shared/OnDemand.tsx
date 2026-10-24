import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  label: string;
  open: boolean;
  onOpen: () => void;
  className?: string;
  add?: boolean;
  disabled?: boolean;
  children: ReactNode;
};

export function OnDemand({
  label,
  open,
  onOpen,
  className = 'button',
  add = false,
  disabled = false,
  children,
}: Props) {
  const button = useRef<HTMLButtonElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (open) {
      area.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
    } else if (document.activeElement === null || document.activeElement === document.body) {
      const target = button.current?.disabled
        ? button.current.closest<HTMLElement>('[tabindex="-1"]')
        : button.current;
      target?.focus();
    }
  }, [open]);

  if (open) {
    return (
      <div ref={area} className="on-demand">
        {children}
      </div>
    );
  }
  return (
    <button ref={button} type="button" className={className} disabled={disabled} onClick={onOpen}>
      {add && (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M8 2v12M2 8h12" />
        </svg>
      )}
      {label}
    </button>
  );
}
