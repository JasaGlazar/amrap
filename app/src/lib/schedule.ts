type Timed = { start_time: string; duration_minutes: number };

const DAY_MINUTES = 24 * 60;

export function minutesOf(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function endOf(template: Timed): number {
  return minutesOf(template.start_time) + template.duration_minutes;
}

export function clock(minutes: number): string {
  const wrapped = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

export function axisRange(templates: Timed[]): { from: number; to: number } {
  const starts = templates.map((template) => minutesOf(template.start_time));
  const ends = templates.map(endOf);
  return {
    from: Math.floor(Math.min(...starts) / 60) * 60,
    to: Math.min(DAY_MINUTES, Math.ceil(Math.max(...ends) / 60) * 60),
  };
}

export function dayLanes(
  templates: (Timed & { id: string })[],
): Map<string, { lane: number; lanes: number }> {
  const sorted = [...templates].sort(
    (a, b) => minutesOf(a.start_time) - minutesOf(b.start_time) || endOf(b) - endOf(a),
  );
  const result = new Map<string, { lane: number; lanes: number }>();
  let group: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const close = () => {
    for (const member of group)
      result.set(member.id, { lane: member.lane, lanes: laneEnds.length });
    group = [];
    laneEnds = [];
  };
  for (const template of sorted) {
    const start = minutesOf(template.start_time);
    if (start >= groupEnd) close();
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = endOf(template);
    groupEnd = Math.max(groupEnd, endOf(template));
    group.push({ id: template.id, lane });
  }
  close();
  return result;
}

type Slot = Timed & { weekday: number; active: boolean };
type Placed = Slot & { id: string };

function intersects(a: Slot, b: Slot): boolean {
  return (
    a.weekday === b.weekday &&
    minutesOf(a.start_time) < endOf(b) &&
    minutesOf(b.start_time) < endOf(a)
  );
}

export function overlapsWith<T extends Placed>(
  candidate: Slot,
  id: string | null,
  templates: T[],
): T[] {
  if (!candidate.active) return [];
  return templates.filter(
    (other) => other.id !== id && other.active && intersects(candidate, other),
  );
}

export function overlappingIds(templates: Placed[]): Set<string> {
  return new Set(
    templates
      .filter((template) => overlapsWith(template, template.id, templates).length > 0)
      .map((template) => template.id),
  );
}
