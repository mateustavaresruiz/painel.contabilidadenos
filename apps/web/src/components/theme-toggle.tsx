import { Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/use-theme";

/**
 * Botão de alternância claro ⇄ escuro. Ícone sol/lua com troca suave
 * (crossfade + rotação). Persiste e propaga via `useTheme`.
 *
 * `variant`:
 *  - "icon"  → quadrado, só ícone (sidebar/topbar do app, nav da home).
 *  - "full"  → ícone + rótulo do PRÓXIMO tema (linha de menu/lista).
 */
export function ThemeToggle({
  variant = "icon",
  className,
}: {
  variant?: "icon" | "full";
  className?: string;
}) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const proximo = isDark ? "claro" : "escuro";

  if (variant === "full") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={`Mudar para o tema ${proximo}`}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
          className,
        )}
      >
        <span className="relative grid size-4 shrink-0 place-items-center">
          <Sun
            className={cn(
              "absolute size-4 transition-all duration-300",
              isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100",
            )}
          />
          <Moon
            className={cn(
              "absolute size-4 transition-all duration-300",
              isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0",
            )}
          />
        </span>
        Tema {proximo}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Mudar para o tema ${proximo}`}
      title={`Tema ${proximo}`}
      className={cn(
        "relative grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
        className,
      )}
    >
      <Sun
        className={cn(
          "absolute size-[1.15rem] transition-all duration-300 ease-brand",
          isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100",
        )}
      />
      <Moon
        className={cn(
          "absolute size-[1.15rem] transition-all duration-300 ease-brand",
          isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0",
        )}
      />
    </button>
  );
}
