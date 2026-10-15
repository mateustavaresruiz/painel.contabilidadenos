import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

/** Abas de navegação dentro de um módulo (ex.: Clientes · Lista | Aniversários). */
export function ModuloAbas({ abas }: { abas: { to: string; label: string; end?: boolean }[] }) {
  return (
    <nav className="inline-flex rounded-full bg-muted p-1" aria-label="Seções do módulo">
      {abas.map((a) => (
        <NavLink
          key={a.to}
          to={a.to}
          end={a.end}
          className={({ isActive }) =>
            cn(
              "rounded-full px-4 py-1.5 text-sm transition-colors",
              isActive ? "bg-card text-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
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
  { to: "/clientes/aniversarios", label: "Aniversários" },
];
