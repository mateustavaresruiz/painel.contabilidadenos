import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias. Configure em apps/web/.env.local",
  );
}

// Sem login (decisão do dono): o cliente fala sempre como `anon`. Nada de
// sessão para guardar nem renovar.
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

export const SUPABASE_URL = url as string;
export const SUPABASE_ANON_KEY = anonKey as string;
