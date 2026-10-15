import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias. Configure em apps/web/.env.local",
  );
}

// Login por e-mail sem senha (docs/LOGIN.md). A sessão fica guardada no
// navegador e é renovada sozinha; com ela o supabase-js manda o JWT do
// usuário em toda consulta, no Storage e no Realtime, e a RLS decide o resto.
// A chave anon sozinha não lê nada.
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // O link gerado pelo Auth (action_link) volta com o token no fragmento.
    detectSessionInUrl: true,
    storageKey: "denos-auth",
  },
});

export const SUPABASE_URL = url as string;
export const SUPABASE_ANON_KEY = anonKey as string;
