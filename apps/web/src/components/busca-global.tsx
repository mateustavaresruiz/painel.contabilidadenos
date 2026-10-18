import { useQuery } from "@tanstack/react-query";
import { Building2, CornerDownLeft, MessageSquare, Search, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";

import { AvatarIniciais } from "@/components/avatar-iniciais";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useDebounced } from "@/hooks/use-debounced";
import { NAV_APP, NAV_CONFIGURACOES } from "@/layouts/app-nav";
import { useEu } from "@/lib/colaborador";
import { corModulo, type CorModulo } from "@/lib/cores-modulo";
import { useModulos } from "@/lib/modulos";
import { orIlike } from "@/lib/queries/helpers";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  grupo: "Páginas" | "Clientes" | "Conversas";
  rotulo: string;
  detalhe?: string;
  to: string;
  icon?: LucideIcon;
  cor?: CorModulo;
  avatar?: { nome: string; semente: string; empresa?: boolean };
};

/** Abre a busca com Ctrl/⌘+K (em qualquer lugar do painel). */
export function useAtalhoBusca(abrir: () => void) {
  useEffect(() => {
    function aoTeclar(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        abrir();
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [abrir]);
}

/**
 * Busca global (Ctrl+K): ir para uma página e achar cliente ou conversa pelo
 * nome. A consulta só vai ao banco com 2+ letras, 250 ms depois de parar de
 * digitar, e traz no máximo 6 de cada.
 */
export function BuscaGlobal({ aberto, onOpenChange }: { aberto: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { tem } = useEu();
  const { ativo } = useModulos();
  const [termo, setTermo] = useState("");
  const [sel, setSel] = useState(0);
  const listaRef = useRef<HTMLDivElement>(null);
  const q = useDebounced(termo.trim(), 250);
  const pode = (ps?: string[]) => !ps || ps.some((p) => tem(p));

  useEffect(() => {
    if (!aberto) setTermo("");
  }, [aberto]);

  const verClientes = ativo("clientes") && tem("clientes.ver");
  const verConversas = ativo("whatsapp") && tem("whatsapp.ver");
  const buscar = q.length >= 2;

  const clientes = useQuery({
    queryKey: ["busca-global", "clientes", q],
    enabled: aberto && buscar && verClientes,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Cliente")
        .select("id, nome, nomeFantasia, tipo, cidade")
        .or(orIlike(["nome", "nomeFantasia"], q))
        .order("nome")
        .limit(6);
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; nomeFantasia: string | null; tipo: "PF" | "PJ"; cidade: string | null }[];
    },
  });
  const conversas = useQuery({
    queryKey: ["busca-global", "conversas", q],
    enabled: aberto && buscar && verConversas,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("WhatsappChat")
        .select("id, chatId, sessaoId, nome")
        .ilike("nome", `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
        .is("apagadoEm", null)
        .order("ultimaMensagemEm", { ascending: false, nullsFirst: false })
        .limit(6);
      if (error) throw error;
      return (data ?? []) as { id: string; chatId: string; sessaoId: string; nome: string | null }[];
    },
  });

  const itens = useMemo<Item[]>(() => {
    const t = termo.trim().toLowerCase();
    const paginas: Item[] = [...NAV_APP, NAV_CONFIGURACOES]
      .filter((i) => (!i.modulo || ativo(i.modulo)) && pode(i.permissao))
      .flatMap((i) => [
        { id: `p:${i.to}`, grupo: "Páginas" as const, rotulo: i.label, to: i.to, icon: i.icon, cor: i.cor },
        ...(i.filhos ?? [])
          .filter((f) => f.to !== i.to && pode(f.permissao))
          .map((f) => ({ id: `p:${f.to}`, grupo: "Páginas" as const, rotulo: `${i.label} › ${f.label}`, to: f.to, icon: i.icon, cor: i.cor })),
      ])
      .filter((p) => !t || p.rotulo.toLowerCase().includes(t));
    const cs: Item[] = buscar
      ? (clientes.data ?? []).map((c) => {
          const nome = c.nomeFantasia || c.nome;
          return {
            id: `c:${c.id}`,
            grupo: "Clientes" as const,
            rotulo: nome,
            detalhe: [c.tipo, c.cidade].filter(Boolean).join(" · "),
            to: `/clientes/${c.id}`,
            avatar: { nome, semente: c.id, empresa: c.tipo === "PJ" },
          };
        })
      : [];
    const vs: Item[] = buscar
      ? (conversas.data ?? []).map((c) => ({
          id: `w:${c.id}`,
          grupo: "Conversas" as const,
          rotulo: c.nome || c.chatId.split("@")[0],
          detalhe: "WhatsApp",
          to: `/whatsapp?instancia=${encodeURIComponent(c.sessaoId)}&chat=${encodeURIComponent(c.chatId)}`,
          avatar: { nome: c.nome ?? "", semente: c.chatId },
        }))
      : [];
    return [...paginas, ...cs, ...vs];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termo, buscar, clientes.data, conversas.data, ativo, tem]);

  useEffect(() => setSel(0), [termo, itens.length]);
  useEffect(() => {
    listaRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function ir(i: Item | undefined) {
    if (!i) return;
    onOpenChange(false);
    navigate(i.to);
  }

  function aoTeclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, itens.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      ir(itens[sel]);
    }
  }

  const carregando = buscar && (clientes.isFetching || conversas.isFetching);
  let ultimoGrupo = "";

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[12vh] translate-y-0 data-[state=open]:slide-in-from-top-2 max-w-xl gap-0 overflow-hidden p-0 max-sm:p-0 max-sm:pt-[env(safe-area-inset-top)] max-sm:grid-rows-[auto_1fr]">
        <DialogTitle className="sr-only">Buscar no painel</DialogTitle>
        <DialogDescription className="sr-only">Páginas, clientes e conversas.</DialogDescription>
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-[18px] shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={aoTeclar}
            placeholder="Ir para página, cliente ou conversa…"
            className="h-14 min-w-0 flex-1 bg-transparent text-base fino:text-[15px] outline-none placeholder:text-muted-foreground"
            aria-label="Buscar"
            role="combobox"
            aria-expanded
            aria-controls="busca-global-lista"
            aria-activedescendant={itens[sel] ? `bg-${itens[sel]!.id}` : undefined}
          />
          <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 text-2xs text-muted-foreground sm:inline toque:hidden">Esc</kbd>
          <button type="button" onClick={() => onOpenChange(false)} className="-mr-2 h-11 shrink-0 px-2 text-sm font-semibold text-primary sm:hidden toque:inline-block">
            Cancelar
          </button>
        </div>
        <div ref={listaRef} id="busca-global-lista" role="listbox" className="max-h-[min(60vh,420px)] overflow-y-auto p-2 max-sm:max-h-none max-sm:min-h-0">
          {itens.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {carregando ? "Procurando…" : buscar ? `Nada encontrado para "${termo.trim()}".` : "Digite pelo menos 2 letras para buscar clientes e conversas."}
            </p>
          ) : (
            itens.map((i, idx) => {
              const cabecalho = i.grupo !== ultimoGrupo ? i.grupo : null;
              ultimoGrupo = i.grupo;
              const Icone = i.icon;
              return (
                <div key={i.id}>
                  {cabecalho && <p className="px-3 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wide text-muted-foreground first:pt-1">{cabecalho}</p>}
                  <button
                    type="button"
                    id={`bg-${i.id}`}
                    role="option"
                    aria-selected={idx === sel}
                    data-i={idx}
                    onMouseMove={() => setSel(idx)}
                    onClick={() => ir(i)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 max-sm:min-h-11 text-left text-sm transition-colors",
                      idx === sel ? "bg-primary/10 text-primary" : "hover:bg-accent",
                    )}
                  >
                    {i.avatar ? (
                      <AvatarIniciais nome={i.avatar.nome} semente={i.avatar.semente} empresa={i.avatar.empresa} size="sm" />
                    ) : Icone ? (
                      <span className="chip-mod grid size-8 shrink-0 place-items-center rounded-lg" style={i.cor ? corModulo(i.cor) : undefined}>
                        <Icone className="size-4" />
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{i.rotulo}</span>
                      {i.detalhe ? <span className="block truncate text-2xs text-muted-foreground">{i.detalhe}</span> : null}
                    </span>
                    {i.grupo === "Conversas" ? <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                    {i.grupo === "Clientes" ? <Building2 className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                    {idx === sel ? <CornerDownLeft className="size-3.5 shrink-0" /> : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
        {/* Dicas de teclado: só com teclado físico. No toque, sai a barra toda. */}
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-2xs text-muted-foreground toque:hidden">
          <span><kbd className="font-sans">↑↓</kbd> navegar</span>
          <span><kbd className="font-sans">Enter</kbd> abrir</span>
          {carregando ? <span className="ml-auto">Procurando…</span> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
