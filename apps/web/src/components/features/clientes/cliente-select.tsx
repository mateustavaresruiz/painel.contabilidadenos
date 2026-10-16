import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/ui/query-error";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useClientesList } from "@/lib/queries/helpers";
import { cn } from "@/lib/utils";

/**
 * Seletor de cliente com busca (a lista pode ter centenas — um <select>
 * comum não serve). Busca por nome, fantasia ou dígitos do telefone.
 */
export function ClienteSelect({
  value,
  onChange,
  disabled,
  placeholder = "Escolha o cliente",
  permitirTodos,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Mostra a opção "Todos os clientes" (filtros). */
  permitirTodos?: boolean;
}) {
  const { data: lista = [], isError, error, refetch } = useClientesList();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const atual = lista.find((c) => c.id === value);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return lista.slice(0, 80);
    const dig = t.replace(/\D/g, "");
    return lista
      .filter(
        (c) =>
          c.nome.toLowerCase().includes(t) ||
          (c.nomeFantasia ?? "").toLowerCase().includes(t) ||
          (dig.length >= 3 && (c.telefone ?? "").replace(/\D/g, "").includes(dig)),
      )
      .slice(0, 80);
  }, [lista, busca]);

  if (isError && lista.length === 0) {
    return <QueryError compacto oque="os clientes" error={error} onRetry={refetch} />;
  }
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "flex h-10 max-sm:h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-base md:text-sm transition-colors hover:border-foreground/20",
            "disabled:opacity-60 disabled:cursor-not-allowed",
          )}
        >
          <span className={cn("truncate", !atual && "text-muted-foreground")}>
            {atual ? atual.nomeFantasia || atual.nome : permitirTodos ? "Todos os clientes" : placeholder}
          </span>
          <ChevronsUpDown className="size-3.5 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-[260px] p-1.5">
        <div className="relative mb-1.5">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar…"
            className="h-8 pl-7 text-base md:text-sm"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {permitirTodos && (
            <Opcao
              ativo={!value}
              onClick={() => {
                onChange(null);
                setAberto(false);
              }}
            >
              Todos os clientes
            </Opcao>
          )}
          {filtrados.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Nenhum cliente.</p>
          ) : (
            filtrados.map((c) => (
              <Opcao
                key={c.id}
                ativo={c.id === value}
                onClick={() => {
                  onChange(c.id);
                  setAberto(false);
                }}
              >
                <span className="block truncate">{c.nomeFantasia || c.nome}</span>
                {c.nomeFantasia && <span className="block truncate text-2xs text-muted-foreground">{c.nome}</span>}
              </Opcao>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Opcao({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
        ativo && "bg-accent/60",
      )}
    >
      <Check className={cn("size-3.5 shrink-0", ativo ? "opacity-100" : "opacity-0")} />
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}
