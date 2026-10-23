import { runAction, type ActionResult, type Client } from './client';

export type SubscriptionKeys = { endpoint: string; p256dh: string; auth: string };

export function savePushSubscription(
  client: Client,
  keys: SubscriptionKeys,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { error } = await client.rpc('save_push_subscription', {
      p_endpoint: keys.endpoint,
      p_p256dh: keys.p256dh,
      p_auth: keys.auth,
    });
    return { data: null, error };
  });
}

export function deletePushSubscription(
  client: Client,
  endpoint: string,
  userId: string,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { error } = await client
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .eq('user_id', userId);
    return { data: null, error };
  });
}

export async function hasPushSubscription(
  client: Client,
  endpoint: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('push_subscriptions')
    .select('endpoint')
    .eq('endpoint', endpoint)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}
