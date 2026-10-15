/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Commit do build (vite.config.ts: env VITE_COMMIT, ou git, ou "desconhecido"). */
declare const __APP_COMMIT__: string;
/** Momento do build (ISO). */
declare const __APP_BUILD_EM__: string;
