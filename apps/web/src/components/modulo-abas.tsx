import { NavLink, useLocation } from "react-router-dom";

import { useFadeRolagem } from "@/hooks/use-fade-rolagem";
import { useEu } from "@/lib/colaborador";
import { cn } from "@/lib/utils";

/** Abas de navegação dentro de um módulo (ex.: Clientes · Lista | Aniversários). */
export function ModuloAbas({ abas }: { abas: { to: string; label: string; end?: boolean; permissao?: string }[] }) {
  const { tem } = useEu();
  const { pathname } = useLocation();
  const ref = useFadeRolagem<HTMLElement>(pathname);
  const visiveis = abas.filter((a) => !a.permissao || tem(a.permissao));
  return (
    // Mesma pílula das abas (components/ui/tabs.tsx): um padrão de aba só no painel.
    <nav
      ref={ref}
      className="inline-flex h-9 max-lg:h-11 max-w-full items-center overflow-x-auto scrollbar-none rounded-full border border-border bg-card p-1"
      aria-label="Seções do módulo"
    >
      {visiveis.map((a) => (
        <NavLink
          key={a.to}
          to={a.to}
          end={a.end}
          className={({ isActive }) =>
            cn(
              "inline-flex h-7 max-lg:h-9 shrink-0 items-center rounded-full px-3.5 text-xs whitespace-nowrap transition-[color,background-color,transform] duration-150 active:scale-[.97]",
              isActive ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:text-foreground",
            )
          }
        >
          {a.label}
        </NavLink>
      ))}
    </nav>
  );
}

export const ABAS_CLIENTES = [
  { to: "/clientes", label: "Clientes", end: true },
  { to: "/clientes/aniversarios", label: "Aniversários", permissao: "aniversarios.ver" },
];
