import { liveAppointmentsBetween, type Appointment } from './appointments';
import type { Client } from './client';
import { getSettings, type GymSettings } from './settings';
import { activeTemplates, blockedBetween, occupancyBetween } from './slots';
import {
  addDays,
  localDateOf,
  occurrenceInWeek,
  overlaps,
  weekRange,
  weekStart,
  type LocalDate,
} from '../lib/time';

export type WeekSlot = {
  key: string;
  templateId: string;
  date: LocalDate;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  booked: number;
  free: number;
  past: boolean;
  blocked: boolean;
};

export type Week = {
  settings: GymSettings;
  start: LocalDate;
  slots: WeekSlot[];
  appointments: Appointment[];
};

export async function loadWeek(
  client: Client,
  options: { now: Date; weekOffset: number; start?: LocalDate; customerId?: string },
): Promise<Week> {
  const { now, weekOffset, customerId } = options;
  const settings = await getSettings(client);
  const start =
    options.start ?? addDays(weekStart(localDateOf(now, settings.timeZone)), weekOffset * 7);
  const { from, to } = weekRange(start, settings.timeZone);
  const templates = await activeTemplates(client);
  const longest = Math.max(0, ...templates.map((template) => template.duration_minutes));
  const [occupancy, blocked, appointments] = await Promise.all([
    occupancyBetween(client, from, to),
    blockedBetween(client, from, new Date(to.getTime() + longest * 60_000)),
    liveAppointmentsBetween(client, from, to, customerId),
  ]);
  const slots = templates.flatMap((template): WeekSlot[] => {
    const occurrence = occurrenceInWeek(template, start, settings.timeZone);
    if (occurrence === null) return [];
    const booked =
      occupancy.find(
        (row) =>
          row.slotTemplateId === template.id &&
          row.startsAt.getTime() === occurrence.startsAt.getTime(),
      )?.bookedCount ?? 0;
    return [
      {
        key: `${template.id}@${occurrence.startsAt.toISOString()}`,
        templateId: template.id,
        date: occurrence.date,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        capacity: template.capacity,
        booked,
        free: Math.max(0, template.capacity - booked),
        past: occurrence.startsAt.getTime() <= now.getTime(),
        blocked: blocked.some((period) => overlaps(occurrence, period)),
      },
    ];
  });
  slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return { settings, start, slots, appointments };
}

export function appointmentsIn(week: Week, slot: WeekSlot): Appointment[] {
  return week.appointments.filter(
    (appointment) =>
      appointment.slotTemplateId === slot.templateId &&
      appointment.startsAt.getTime() === slot.startsAt.getTime(),
  );
}

export function appointmentsOutsideSlots(week: Week): Appointment[] {
  return week.appointments.filter(
    (appointment) =>
      !week.slots.some(
        (slot) =>
          appointment.slotTemplateId === slot.templateId &&
          appointment.startsAt.getTime() === slot.startsAt.getTime(),
      ),
  );
}
