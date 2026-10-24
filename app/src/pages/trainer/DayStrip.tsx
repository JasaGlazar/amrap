import { t } from '../../i18n';
import { addDays, formatLocalDate, type LocalDate } from '../../lib/time';

type Props = {
  start: LocalDate;
  selected: LocalDate;
  today: LocalDate;
  onSelect: (date: LocalDate) => void;
};

export function DayStrip({ start, selected, today, onSelect }: Props) {
  const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(start, offset));
  return (
    <div className="day-strip" role="group" aria-label={t.trainer.days}>
      {days.map((date) => (
        <button
          key={date}
          type="button"
          className="day-button"
          aria-label={formatLocalDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}
          aria-pressed={date === selected}
          aria-current={date === today ? 'date' : undefined}
          onClick={() => onSelect(date)}
        >
          <span>{formatLocalDate(date, { weekday: 'short' })}</span>
          <span className="day-button-date">{formatLocalDate(date, { day: 'numeric' })}</span>
        </button>
      ))}
    </div>
  );
}
