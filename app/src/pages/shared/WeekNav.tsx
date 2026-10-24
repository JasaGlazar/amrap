import { fill, t } from '../../i18n';
import { addDays, formatLocalDate, type LocalDate } from '../../lib/time';

type Props = {
  start: LocalDate | null;
  canGoBack: boolean;
  disabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

const dayMonth = { day: 'numeric', month: 'numeric' } as const;

export function WeekNav({ start, canGoBack, disabled = false, onPrevious, onNext }: Props) {
  return (
    <div className="week-nav">
      <button
        type="button"
        className="button secondary small"
        aria-label={t.calendar.previousWeek}
        disabled={disabled || !canGoBack}
        onClick={onPrevious}
      >
        {t.calendar.previousArrow}
      </button>
      <span className="week-range">
        {start !== null &&
          fill(t.calendar.weekRange, {
            from: formatLocalDate(start, dayMonth),
            to: formatLocalDate(addDays(start, 6), dayMonth),
          })}
      </span>
      <button
        type="button"
        className="button secondary small"
        aria-label={t.calendar.nextWeek}
        disabled={disabled}
        onClick={onNext}
      >
        {t.calendar.nextArrow}
      </button>
    </div>
  );
}
