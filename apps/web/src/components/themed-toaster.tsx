import { Toaster } from "sonner";

import { useTheme } from "@/lib/use-theme";

/**
 * Toaster (Sonner) que segue o tema vivo. O `theme` precisa REAGIR ao toggle,
 * então fica num componente com o hook — ler o tema uma vez no module-load
 * deixava o toast preso no tema do boot.
 */
export function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster richColors closeButton position="top-right" theme={theme} />;
}
