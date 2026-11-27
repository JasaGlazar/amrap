export type NotificationKind =
  | 'cutoff_reminder'
  | 'booking_created'
  | 'booking_cancelled'
  | 'credit_topup'
  | 'credit_adjustment'
  | 'appointment_cancelled_by_trainer'
  | 'booking_restored'
  | 'customer_registered';

export interface ClaimedRow {
  notification_id: string;
  kind: NotificationKind;
  data: Record<string, unknown>;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type Urgency = 'very-low' | 'low' | 'normal' | 'high';

export interface BuiltPush {
  payload: string;
  ttl: number;
  urgency: Urgency;
  topic?: string;
}
