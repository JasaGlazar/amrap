import { runAction, type ActionResult, type Client } from './client';

export type GymSettings = {
  lateCancelHours: number;
  timeZone: string;
  customerBookingEnabled: boolean;
};

export async function getSettings(client: Client): Promise<GymSettings> {
  const { data, error } = await client
    .from('settings')
    .select('late_cancel_hours, timezone, customer_booking_enabled')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  if (data === null) throw new Error('settings row is missing');
  return {
    lateCancelHours: data.late_cancel_hours,
    timeZone: data.timezone,
    customerBookingEnabled: data.customer_booking_enabled,
  };
}

export function setLateCancelHours(client: Client, hours: number): Promise<ActionResult<null>> {
  return runAction(() => client.from('settings').update({ late_cancel_hours: hours }).eq('id', 1));
}
