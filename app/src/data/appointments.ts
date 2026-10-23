import { runAction, type ActionResult, type AppointmentStatus, type Client } from './client';

export type Appointment = {
  id: string;
  customerId: string;
  slotTemplateId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
};

const columns = 'id, customer_id, slot_template_id, starts_at, ends_at, status';

type Row = {
  id: string;
  customer_id: string;
  slot_template_id: string | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
};

function toAppointment(row: Row): Appointment {
  return {
    id: row.id,
    customerId: row.customer_id,
    slotTemplateId: row.slot_template_id,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    status: row.status,
  };
}

export async function upcomingAppointments(
  client: Client,
  customerId: string,
  now: Date,
): Promise<Appointment[]> {
  const { data, error } = await client
    .from('appointments')
    .select(columns)
    .eq('customer_id', customerId)
    .eq('status', 'booked')
    .gt('starts_at', now.toISOString())
    .order('starts_at');
  if (error) throw error;
  return data.map(toAppointment);
}

export async function pastAppointments(
  client: Client,
  customerId: string,
  now: Date,
): Promise<Appointment[]> {
  const { data, error } = await client
    .from('appointments')
    .select(columns)
    .eq('customer_id', customerId)
    .or(`status.neq.booked,starts_at.lte.${now.toISOString()}`)
    .order('starts_at', { ascending: false });
  if (error) throw error;
  return data.map(toAppointment);
}

export async function liveAppointmentsBetween(
  client: Client,
  from: Date,
  to: Date,
  customerId?: string,
): Promise<Appointment[]> {
  let query = client
    .from('appointments')
    .select(columns)
    .in('status', ['booked', 'charged'])
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString());
  if (customerId !== undefined) query = query.eq('customer_id', customerId);
  const { data, error } = await query.order('starts_at');
  if (error) throw error;
  return data.map(toAppointment);
}

export type Booking =
  | { customerId: string; startsAt: Date; slotTemplateId: string }
  | { customerId: string; startsAt: Date; endsAt: Date };

export function book(client: Client, booking: Booking): Promise<ActionResult<string | null>> {
  return runAction(() =>
    client.rpc(
      'book',
      'slotTemplateId' in booking
        ? {
            p_customer_id: booking.customerId,
            p_starts_at: booking.startsAt.toISOString(),
            p_slot_template_id: booking.slotTemplateId,
          }
        : {
            p_customer_id: booking.customerId,
            p_starts_at: booking.startsAt.toISOString(),
            p_ends_at: booking.endsAt.toISOString(),
          },
    ),
  );
}

export function cancel(client: Client, appointmentId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { error } = await client.rpc('cancel', { p_appointment_id: appointmentId });
    return { data: undefined, error };
  });
}

export async function futureBookedCount(
  client: Client,
  slotTemplateId: string,
  now: Date,
): Promise<number> {
  const { data, error } = await client
    .from('appointments')
    .select('id')
    .eq('slot_template_id', slotTemplateId)
    .eq('status', 'booked')
    .gt('starts_at', now.toISOString());
  if (error) throw error;
  return data.length;
}

export async function chargedSince(
  client: Client,
  customerId: string,
  since: Date,
): Promise<Appointment[]> {
  const { data, error } = await client
    .from('appointments')
    .select(columns)
    .eq('customer_id', customerId)
    .eq('status', 'charged')
    .gte('starts_at', since.toISOString())
    .order('starts_at', { ascending: false });
  if (error) throw error;
  return data.map(toAppointment);
}
