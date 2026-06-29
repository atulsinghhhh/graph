import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseAdmin: SupabaseClient | null = null;

export async function initPostgres(): Promise<'connected' | 'not_configured' | string> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return 'not_configured';

  try {
    supabaseAdmin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Probe with a lightweight RPC call; a missing table just means schema not yet applied
    const { error } = await supabaseAdmin.from('organizations').select('id').limit(1);

    if (error) {
      // Table missing means schema not yet applied — DB is still reachable
      if (
        error.message.includes('does not exist') ||
        error.message.includes('schema cache') ||
        error.code === '42P01'
      ) {
        console.log('Postgres (Supabase) connected — schema pending');
        return 'connected';
      }
      return `error: ${error.message}`;
    }

    console.log('Postgres (Supabase) connected');
    return 'connected';
  } catch (err: any) {
    supabaseAdmin = null;
    return `error: ${err.message}`;
  }
}

export function getSupabase(): SupabaseClient {
  if (!supabaseAdmin) throw new Error('Postgres not initialized');
  return supabaseAdmin;
}
