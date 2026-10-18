import type { CSSProperties } from "react";
import { Toaster } from "sonner";

import { useTheme } from "@/lib/use-theme";

/**
 * Toaster (Sonner) que segue o tema vivo. O `theme` precisa REAGIR ao toggle,
 * então fica num componente com o hook — ler o tema uma vez no module-load
 * deixava o toast preso no tema do boot.
 *
 * Visual do DESIGN.md: todo toast é a mesma superfície flutuante (canvas,
 * hairline, raio 18, a única sombra permitida). O estado vem só na cor do
 * ícone; nada de fundo verde/vermelho (o `richColors` pintava o balão todo).
 */
const VARS = {
  "--normal-bg": "var(--popover)",
  "--normal-border": "var(--border)",
  "--normal-text": "var(--popover-foreground)",
  "--border-radius": "var(--radius-card)",
} as CSSProperties;

export function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      closeButton
      position="top-right"
      theme={theme}
      gap={8}
      // pointer-events: com um diálogo/gaveta aberto o Radix desliga os cliques
      // fora dele (body pointer-events: none) e o "Desfazer" ficava inalcançável.
      style={{ ...VARS, pointerEvents: "auto" }}
      toastOptions={{
        classNames: {
          toast: "!shadow-flutuante !text-xs !gap-2.5 !font-sans",
          title: "!text-xs !font-semibold",
          description: "!text-2xs !text-muted-foreground",
          error: "[&_[data-icon]]:!text-destructive",
          warning: "[&_[data-icon]]:!text-warning",
          info: "[&_[data-icon]]:!text-primary",
          success: "[&_[data-icon]]:!text-success",
          actionButton: "!rounded-full !bg-primary !text-primary-foreground !text-2xs !px-3",
          cancelButton: "!rounded-full !text-2xs",
          closeButton: "!bg-popover !border-border !text-muted-foreground",
        },
      }}
    />
  );
}
