import { runAction, type ActionResult, type Client } from './client';

export type Registration = { name: string; phone: string; code: string };

export function registerCustomer(
  client: Client,
  input: Registration,
): Promise<ActionResult<string>> {
  return runAction(async () => {
    const { data, error } = await client.rpc('register_customer', {
      p_name: input.name.trim(),
      p_phone: input.phone.trim(),
      p_code: input.code,
    });
    if (!error && data === null) throw new Error('register_customer returned no id');
    return { data: data as string, error };
  });
}
