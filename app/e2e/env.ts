// The local stack's public demo keys (`supabase status`), not secrets.
const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];

function localUrl(value: string): string {
  const host = new URL(value).hostname;
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `SUPABASE_URL points at ${host}. Browser tests run only against the local stack (127.0.0.1 or localhost).`,
    );
  }
  return value;
}

export const env = {
  supabaseUrl: localUrl(process.env.SUPABASE_URL || LOCAL_URL),
  anonKey: process.env.SUPABASE_ANON_KEY || LOCAL_ANON_KEY,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || LOCAL_SERVICE_ROLE_KEY,
};
