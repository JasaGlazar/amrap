import { CANCEL_REASON_MAX } from '../../data/appointments';
import { t } from '../../i18n';

type Props = { value: string; onChange: (value: string) => void };

export function ReasonField({ value, onChange }: Props) {
  return (
    <label className="dialog-field">
      {t.cancelDialog.reason}
      <input
        autoComplete="off"
        maxLength={CANCEL_REASON_MAX}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
