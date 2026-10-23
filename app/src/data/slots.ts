import { runAction, type ActionResult, type Client } from './client';

export type SlotTemplate = {
  id: string;
  weekday: number;
  start_time: string;
  duration_minutes: number;
  capacity: number;
};

export type Occupancy = { slotTemplateId: string; startsAt: Date; bookedCount: number };

export type TemplateFields = Omit<SlotTemplate, 'id'> & { active: boolean };

export type BlockedPeriod = { startsAt: Date; endsAt: Date; reason: string | null };

export type StoredBlockedPeriod = BlockedPeriod & { id: string };

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

export async function allTemplates(
  client: Client,
): Promise<(SlotTemplate & { active: boolean })[]> {
  const { data, error } = await client
    .from('slot_templates')
    .select('id, weekday, start_time, duration_minutes, capacity, active')
    .order('weekday')
    .order('start_time');
  if (error) throw error;
  return data;
}

export function saveTemplate(
  client: Client,
  id: string | null,
  fields: TemplateFields,
): Promise<ActionResult<null>> {
  return runAction(() =>
    id === null
      ? client.from('slot_templates').insert(fields)
      : client.from('slot_templates').update(fields).eq('id', id),
  );
}

export async function upcomingBlocked(client: Client, now: Date): Promise<StoredBlockedPeriod[]> {
  const { data, error } = await client
    .from('blocked_periods')
    .select('id, starts_at, ends_at, reason')
    .gt('ends_at', now.toISOString())
    .order('starts_at');
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    reason: row.reason,
  }));
}

export function saveBlocked(
  client: Client,
  id: string | null,
  period: BlockedPeriod,
): Promise<ActionResult<null>> {
  const fields = {
    starts_at: period.startsAt.toISOString(),
    ends_at: period.endsAt.toISOString(),
    reason: period.reason,
  };
  return runAction(() =>
    id === null
      ? client.from('blocked_periods').insert(fields)
      : client.from('blocked_periods').update(fields).eq('id', id),
  );
}

export function deleteBlocked(client: Client, id: string): Promise<ActionResult<null>> {
  return runAction(() => client.from('blocked_periods').delete().eq('id', id));
}
