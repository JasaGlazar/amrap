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

export async function getRegistrationCode(client: Client): Promise<string | null> {
  const { data, error } = await client
    .from('registration_settings')
    .select('code')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data?.code ?? null;
}

export function setRegistrationCode(
  client: Client,
  code: string | null,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    // The generated type says string, but the function takes null to close registration.
    const { error } = await client.rpc('set_registration_code', { p_code: code as string });
    return { data: null, error };
  });
}

export function newRegistrationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
