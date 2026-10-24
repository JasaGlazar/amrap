import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n';
import { useModal } from '../shared/modal';

type Props = {
  templateId: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function TemplateDialog({ templateId, busy, onClose, children }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModal(
    dialogRef,
    () => {
      if (!busy) onClose();
    },
    {
      focusFirst: true,
      returnTo: () => document.querySelector<HTMLElement>(`[data-template-id="${templateId}"]`),
    },
  );
  return createPortal(
    <div className="overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.settings.editTemplate}
        tabIndex={-1}
        className="dialog"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
