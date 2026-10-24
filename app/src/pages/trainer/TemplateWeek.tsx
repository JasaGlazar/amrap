import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import type { SlotTemplate } from '../../data/slots';
import { fill, plural, t } from '../../i18n';
import { axisRange, clock, dayLanes, endOf, minutesOf, overlappingIds } from '../../lib/schedule';
import { weekdayHeading } from '../../lib/time';

export type WeekTemplate = SlotTemplate & { active: boolean };

type Props = {
  templates: WeekTemplate[];
  onEdit: (id: string) => void;
};

const weekdays = [0, 1, 2, 3, 4, 5, 6];

function byStart(a: WeekTemplate, b: WeekTemplate) {
  return minutesOf(a.start_time) - minutesOf(b.start_time);
}

function marks(template: WeekTemplate, overlapping: Set<string>): string[] {
  if (!template.active) return [t.settings.inactive];
  return overlapping.has(template.id) ? [t.settings.overlapping] : [];
}

function blockLabel(template: WeekTemplate, overlapping: Set<string>): string {
  return fill(t.settings.blockLabel, {
    day: weekdayHeading(template.weekday),
    time: template.start_time.slice(0, 5),
    minutes: template.duration_minutes,
    places: plural(t.settings.places, template.capacity),
    marks: marks(template, overlapping)
      .map((mark) => `, ${mark}`)
      .join(''),
  });
}

function Tags({ template, overlapping }: { template: WeekTemplate; overlapping: Set<string> }) {
  return marks(template, overlapping).map((mark) => (
    <span key={mark} className="tag">
      {mark}
    </span>
  ));
}

export function WeekGrid({ templates, onEdit }: Props) {
  const id = useId();
  const { from, to } = axisRange(templates);
  const overlapping = overlappingIds(templates);
  const legend = [
    ...(overlapping.size > 0 ? [t.settings.overlapLegend] : []),
    ...(templates.some((template) => !template.active) ? [t.settings.inactiveLegend] : []),
  ];
  const hours: number[] = [];
  for (let hour = from; hour < to; hour += 60) hours.push(hour);
  const days = weekdays.map((weekday) => {
    const day = templates.filter((template) => template.weekday === weekday).sort(byStart);
    return { weekday, day, lanes: dayLanes(day) };
  });
  const maxLanes = Math.max(
    1,
    ...days.flatMap(({ lanes }) => [...lanes.values()].map((place) => place.lanes)),
  );
  return (
    <>
      {legend.length > 0 && (
        <p className="legend">
          {legend.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </p>
      )}
      <div className="wide">
        <div
          className="template-grid"
          style={{ '--span': to - from, '--max-lanes': maxLanes } as CSSProperties}
        >
          <div className="template-axis" aria-hidden="true">
            {[...hours, to].map((hour) => (
              <span key={hour} style={{ '--at': hour - from } as CSSProperties}>
                {clock(hour)}
              </span>
            ))}
          </div>
          {days.map(({ weekday, day, lanes }) => {
            return (
              <section key={weekday} className="template-day" aria-labelledby={`${id}-${weekday}`}>
                <h3 id={`${id}-${weekday}`}>{weekdayHeading(weekday)}</h3>
                <div className="template-day-body">
                  {hours.map((hour) => (
                    <span
                      key={hour}
                      className="template-hour"
                      style={{ '--at': hour - from } as CSSProperties}
                    />
                  ))}
                  {day.length > 0 && (
                    <ul className="template-blocks">
                      {day.map((template) => {
                        const start = minutesOf(template.start_time);
                        const place = lanes.get(template.id) ?? { lane: 0, lanes: 1 };
                        const style = {
                          '--start': start - from,
                          '--length': Math.min(endOf(template), to) - start,
                          '--lane': place.lane,
                          '--lanes': place.lanes,
                        } as CSSProperties;
                        return (
                          <li key={template.id} style={style}>
                            <button
                              type="button"
                              className={
                                !template.active
                                  ? 'template-block inactive'
                                  : overlapping.has(template.id)
                                    ? 'template-block overlap'
                                    : 'template-block'
                              }
                              data-template-id={template.id}
                              aria-label={blockLabel(template, overlapping)}
                              onClick={() => onEdit(template.id)}
                            >
                              <span className="template-block-time">
                                {fill(t.settings.timeRange, {
                                  start: clock(start),
                                  end: clock(endOf(template)),
                                })}
                              </span>
                              <span className="template-block-places">
                                {plural(t.settings.places, template.capacity)}
                              </span>
                              <Tags template={template} overlapping={overlapping} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function DayGroups({
  templates,
  onEdit,
  editing,
  editForm,
}: Props & { editing: string | null; editForm: (template: WeekTemplate) => ReactNode }) {
  const id = useId();
  const overlapping = overlappingIds(templates);
  const shown = useRef(editing);

  useEffect(() => {
    const closed = shown.current;
    shown.current = editing;
    if (editing !== null) {
      document
        .querySelector(`[data-editing="${editing}"]`)
        ?.querySelector<HTMLElement>('input, select, textarea')
        ?.focus();
    } else if (closed !== null && document.activeElement === document.body) {
      document.querySelector<HTMLElement>(`[data-template-id="${closed}"]`)?.focus();
    }
  }, [editing]);

  return weekdays.map((weekday) => {
    const day = templates.filter((template) => template.weekday === weekday).sort(byStart);
    if (day.length === 0) return null;
    return (
      <section key={weekday} className="day-group" aria-labelledby={`${id}-${weekday}`}>
        <h3 id={`${id}-${weekday}`}>{weekdayHeading(weekday)}</h3>
        <ul className="list">
          {day.map((template) =>
            editing === template.id ? (
              <li key={template.id} data-editing={template.id}>
                {editForm(template)}
              </li>
            ) : (
              <li key={template.id} className={template.active ? 'row' : 'row muted'}>
                <span className="row-text">
                  <span className="slot-time">{template.start_time.slice(0, 5)}</span>
                  <span>
                    {fill(t.settings.slotDetails, {
                      minutes: template.duration_minutes,
                      places: plural(t.settings.places, template.capacity),
                    })}
                  </span>
                  <Tags template={template} overlapping={overlapping} />
                </span>
                <button
                  type="button"
                  className="button secondary small"
                  data-template-id={template.id}
                  aria-label={blockLabel(template, overlapping)}
                  onClick={() => onEdit(template.id)}
                >
                  {t.settings.edit}
                </button>
              </li>
            ),
          )}
        </ul>
      </section>
    );
  });
}
