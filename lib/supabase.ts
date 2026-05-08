// lib/supabase.ts
// Shared Supabase client + Aspen Grove ingest helper
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export const supabase = createClient(
  process.env.SUPABASE_URL      || 'https://kjebemdgvjvuutzvhbtp.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function aspenIngest(type: string, title: string, metadata: any): Promise<string> {
  const str     = JSON.stringify(metadata, Object.keys(metadata || {}).sort());
  const hash    = crypto.createHash('sha256').update(str).digest('hex');
  const pointer = `aspen://node/${hash.slice(0, 16)}`;

  await supabase.from('apex_integration_events').insert({
    case_id:    '1FDV-23-0001009',
    event_type: type,
    title,
    metadata:   { ...metadata, hash, pointer, timestamp: new Date().toISOString() },
  });

  return pointer;
}
