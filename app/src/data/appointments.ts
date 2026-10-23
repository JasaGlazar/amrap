import { runAction, type ActionResult, type AppointmentStatus, type Client } from './client';

export type Appointment = {
  id: string;
  slotTemplateId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
};

const columns = 'id, slot_template_id, starts_at, ends_at, status';

type Row = {
  id: string;
  slot_template_id: string | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
};

function toAppointment(row: Row): Appointment {
  return {
    id: row.id,
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
  customerId: string,
  from: Date,
  to: Date,
): Promise<Appointment[]> {
  const { data, error } = await client
    .from('appointments')
    .select(columns)
    .eq('customer_id', customerId)
    .in('status', ['booked', 'charged'])
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString());
  if (error) throw error;
  return data.map(toAppointment);
}

export function book(
  client: Client,
  booking: { customerId: string; startsAt: Date; slotTemplateId: string },
): Promise<ActionResult> {
  return runAction(() =>
    client.rpc('book', {
      p_customer_id: booking.customerId,
      p_starts_at: booking.startsAt.toISOString(),
      p_slot_template_id: booking.slotTemplateId,
    }),
  );
}

export function cancel(client: Client, appointmentId: string): Promise<ActionResult> {
  return runAction(() => client.rpc('cancel', { p_appointment_id: appointmentId }));
}
