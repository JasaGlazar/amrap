export interface Env {
  get(name: string): string | undefined;
}

export function serviceKey(env: Env): string {
  const key = defaultSecretKey(env.get('SUPABASE_SECRET_KEYS')) ||
    env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) {
    throw new Error(
      'send-push: no service key; expected SUPABASE_SECRET_KEYS with a "default" entry or SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  return key;
}

function defaultSecretKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const key = (parsed as Record<string, unknown>).default;
    return typeof key === 'string' && key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
}
