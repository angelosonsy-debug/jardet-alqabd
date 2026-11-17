import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY غير موجودين. انسخ .env.example إلى .env وأضف قيم مشروعك في Supabase.',
  );
}

// Only the public anon key ever ships to the browser. RLS policies in
// supabase/migrations/0001_init.sql are what actually protect the data —
// the service role key must never appear in frontend code or env files
// prefixed with VITE_ (those are inlined into the client bundle).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
