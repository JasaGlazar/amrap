import { useState, type FormEvent } from 'react';
import { t } from '../../i18n';

type Props = {
  options: { id: string; label: string }[];
  busy: boolean;
  onSubmit: (templateId: string) => void;
  onCancel: () => void;
};

export function RuleForm({ options, busy, onSubmit, onCancel }: Props) {
  const [chosen, setChosen] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (chosen !== '') onSubmit(chosen);
  }

  return (
    <form className="form card" onSubmit={submit} aria-label={t.customerDetail.addRuleLabel}>
      <h3>{t.customerDetail.addRuleLabel}</h3>
      <label>
        {t.customerDetail.ruleTemplate}
        <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
          <option value="">{t.customerDetail.chooseTemplate}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button type="submit" className="button" disabled={busy || chosen === ''}>
          {t.customerDetail.addRule}
        </button>
        <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}
