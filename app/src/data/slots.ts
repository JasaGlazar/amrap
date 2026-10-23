import type { Client } from './client';

export type SlotTemplate = {
  id: string;
  weekday: number;
  start_time: string;
  duration_minutes: number;
  capacity: number;
};

export type Occupancy = { slotTemplateId: string; startsAt: Date; bookedCount: number };

export type BlockedPeriod = { startsAt: Date; endsAt: Date; reason: string | null };

export async function activeTemplates(client: Client): Promise<SlotTemplate[]> {
  const { data, error } = await client
    .from('slot_templates')
    .select('id, weekday, start_time, duration_minutes, capacity')
    .eq('active', true)
    .order('weekday')
    .order('start_time');
  if (error) throw error;
  return data;
}

export async function occupancyBetween(client: Client, from: Date, to: Date): Promise<Occupancy[]> {
  const { data, error } = await client
    .from('slot_occupancy')
    .select('slot_template_id, starts_at, booked_count')
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString());
  if (error) throw error;
  return data.flatMap((row) =>
    row.slot_template_id === null || row.starts_at === null
      ? []
      : [
          {
            slotTemplateId: row.slot_template_id,
            startsAt: new Date(row.starts_at),
            bookedCount: row.booked_count ?? 0,
          },
        ],
  );
}

export async function blockedBetween(
  client: Client,
  from: Date,
  to: Date,
): Promise<BlockedPeriod[]> {
  const { data, error } = await client
    .from('blocked_periods')
    .select('starts_at, ends_at, reason')
    .lt('starts_at', to.toISOString())
    .gt('ends_at', from.toISOString());
  if (error) throw error;
  return data.map((row) => ({
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    reason: row.reason,
  }));
}
