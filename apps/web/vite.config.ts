import { execSync } from "node:child_process";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Commit publicado (Configurações > Sistema). No Docker do Easypanel não há
// .git: vem do build arg VITE_COMMIT; localmente, do git.
function commitDoBuild(): string {
  // VITE_COMMIT (fixado na mão) ou GIT_SHA (o Easypanel passa no build de origem Git).
  const env = (process.env.VITE_COMMIT || process.env.GIT_SHA || "").trim();
  if (/^[0-9a-f]{7,40}$/i.test(env)) return env.slice(0, 7);
  if (env) return env.slice(0, 12);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "desconhecido";
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify(commitDoBuild()),
    __APP_BUILD_EM__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // Vendors pesados em chunks próprios: cacheiam entre deploys.
        // recharts fica de fora de propósito — vai junto do gráfico (lazy).
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "radix-vendor": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-label",
            "@radix-ui/react-popover",
            "@radix-ui/react-select",
            "@radix-ui/react-slot",
            "@radix-ui/react-tabs",
            "@radix-ui/react-tooltip",
          ],
          "supabase-vendor": ["@supabase/supabase-js"],
          "query-vendor": ["@tanstack/react-query"],
          "form-vendor": ["react-hook-form", "@hookform/resolvers", "zod"],
        },
      },
    },
  },
});
