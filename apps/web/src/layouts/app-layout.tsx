import { Check, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";
import { Suspense, useCallback, useEffect, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { Logo, LogoMark } from "@/components/logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { PaginaSkeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { NAV_APP, NAV_CONFIGURACOES, type NavItem } from "@/layouts/app-nav";
import { useEu } from "@/lib/colaborador";
import { useMarca, useModulos } from "@/lib/modulos";
import { useTheme } from "@/lib/use-theme";
import { cn } from "@/lib/utils";
import { preCarregar } from "@/routes/paginas";

const CHAVE_RECOLHIDA = "denos:sidebar-recolhida";

function lerRecolhida(): boolean {
  try {
    return localStorage.getItem(CHAVE_RECOLHIDA) === "1";
  } catch {
    return false;
  }
}

/** Menu lateral recolhido (só ícones) no desktop, lembrado entre visitas. Atalho: Ctrl/⌘ + B. */
function useSidebarRecolhida() {
  const [recolhida, setRecolhida] = useState(lerRecolhida);
  const alternar = useCallback(() => {
    setRecolhida((r) => {
      try {
        localStorage.setItem(CHAVE_RECOLHIDA, r ? "0" : "1");
      } catch {
        /* navegador sem storage: vale só nesta aba */
      }
      return !r;
    });
  }, []);
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "b" || e.altKey || e.shiftKey) return;
      const alvo = e.target;
      if (alvo instanceof Element && alvo.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
      alternar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [alternar]);
  return { recolhida, alternar };
}

const reduzMovimento = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * Navegação do menu com View Transition (onde o navegador tem): o conteúdo
 * troca num crossfade curto em vez de piscar. O chunk da página é baixado
 * ANTES da transição (a pré-carga no hover quase sempre já resolveu), para o
 * quadro novo não sair em branco. Sem suporte, é o clique normal do link e o
 * conteúdo entra com a animação CSS `animate-page-enter`.
 */
function useNavegarSuave() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  return useCallback(
    (e: MouseEvent<HTMLAnchorElement>, to: string) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (typeof document.startViewTransition !== "function" || reduzMovimento()) return;
      if (to === pathname + search || to === pathname) return;
      e.preventDefault();
      void preCarregar(to).then(() => {
        const raiz = document.documentElement;
        raiz.dataset.vt = "1";
        const vt = document.startViewTransition(() => {
          flushSync(() => navigate(to));
        });
        void vt.finished.finally(() => {
          delete raiz.dataset.vt;
        });
      });
    },
    [navigate, pathname, search],
  );
}

/**
 * Casca do painel: menu lateral fixo (recolhível) no desktop, gaveta no
 * celular. No rodapé do menu, a conta (tema e Sair).
 */
export function AppLayout() {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { recolhida, alternar } = useSidebarRecolhida();
  const { ativo } = useModulos();

  // Radix não fecha sozinho quando só o pathname muda.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Pré-carga ociosa das páginas do menu: o primeiro clique já abre na hora.
  const caminhosMenu = NAV_APP.filter((i) => !i.modulo || ativo(i.modulo))
    .flatMap((i) => [i.to, ...(i.filhos?.map((f) => f.to) ?? [])])
    .join(",");
  useEffect(() => {
    const caminhos = caminhosMenu.split(",");
    const ocioso = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    const cancelar = window.cancelIdleCallback ?? window.clearTimeout;
    const id = ocioso(() => {
      caminhos.forEach((c) => void preCarregar(c));
    });
    return () => cancelar(id);
  }, [caminhosMenu]);

  // O Atendimento ocupa a altura toda e tem scroll próprio nas colunas.
  const telaCheia = location.pathname === "/whatsapp" || location.pathname === "/whatsapp/";

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      {/* Barra de topo: só no celular. Soma o entalhe do iPhone. */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between border-b border-border barra-fixa px-4 pt-safe-t h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="grid place-items-center size-11 rounded-full transition-[background-color,transform] duration-150 hover:bg-accent/60 active:scale-[.97] -ml-2.5"
          aria-label="Abrir menu"
        >
          <Menu className="size-5" />
        </button>
        <Link to="/" className="inline-flex h-8">
          <Logo className="h-8" />
        </Link>
        <EuBotao compacto />
      </header>

      <aside
        className={cn(
          "hidden md:flex shrink-0 border-r border-border bg-background flex-col min-h-0 overflow-hidden",
          "transition-[width] duration-200 ease-brand motion-reduce:transition-none",
          recolhida ? "w-16" : "w-[248px]",
        )}
        data-recolhida={recolhida || undefined}
      >
        <Sidebar recolhida={recolhida} alternar={alternar} />
      </aside>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" showCloseButton overlayClassName="md:hidden" className="md:hidden pl-safe-l bg-background">
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <SheetDescription className="sr-only">Páginas do painel.</SheetDescription>
          <Sidebar onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>

      <main id="main-content" className="flex-1 min-h-0 min-w-0 flex flex-col [view-transition-name:conteudo]">
        <div
          key={location.pathname}
          className={cn(
            "flex-1 min-h-0 animate-page-enter",
            telaCheia ? "overflow-hidden flex flex-col" : "overflow-auto overscroll-contain",
          )}
        >
          <Suspense fallback={telaCheia ? null : <PaginaSkeleton />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

function Sidebar({
  onNavigate,
  recolhida = false,
  alternar,
}: {
  onNavigate?: () => void;
  recolhida?: boolean;
  alternar?: () => void;
}) {
  const { ativo } = useModulos();
  const { tem } = useEu();
  const { data: marca } = useMarca();
  const pode = (ps?: string[]) => !ps || ps.some((p) => tem(p));
  // Módulo desligado em Configurações some do menu; item sem permissão também.
  const itens = NAV_APP.filter((i) => (!i.modulo || ativo(i.modulo)) && pode(i.permissao)).map((i) =>
    i.filhos ? { ...i, filhos: i.filhos.filter((f) => pode(f.permissao)) } : i,
  );
  const configuracoes = tem("configuracoes.gerenciar")
    ? NAV_CONFIGURACOES
    : { ...NAV_CONFIGURACOES, to: "/configuracoes?tab=conexoes" };
  const AlternarIcone = recolhida ? PanelLeftOpen : PanelLeftClose;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={cn("shrink-0 flex items-center h-[76px] mb-1", recolhida ? "justify-center px-0" : "pl-5 pr-3 gap-2")}>
        <NavLink
          to="/"
          end
          onClick={onNavigate}
          className={cn("flex min-w-0 items-center gap-2.5", recolhida ? "justify-center" : "flex-1")}
          aria-label="Início"
        >
          {recolhida ? (
            <LogoMark className="size-8" />
          ) : (
            <span className="flex min-w-0 flex-col">
              <Logo className="h-9" />
              <span className="mt-0.5 text-2xs text-muted-foreground truncate">{marca?.nome ?? "Painel interno"}</span>
            </span>
          )}
        </NavLink>
        {alternar && !recolhida && (
          <Tooltip label="Recolher menu (Ctrl+B)" side="right">
            <button
              type="button"
              onClick={alternar}
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-[color,background-color,transform] duration-150 hover:bg-accent hover:text-foreground active:scale-[.97]"
              aria-label="Recolher menu"
            >
              <AlternarIcone className="size-4" />
            </button>
          </Tooltip>
        )}
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pb-3 space-y-0.5" aria-label="Páginas">
        {itens.map((item) => (
          <ItemNav key={item.to} item={item} onNavigate={onNavigate} recolhida={recolhida} />
        ))}
      </nav>
      <div className="px-3 pb-3 pt-2 border-t border-divider space-y-0.5 shrink-0">
        {pode(NAV_CONFIGURACOES.permissao) && (tem("configuracoes.gerenciar") || ativo("whatsapp")) && (
          <ItemNav item={configuracoes} onNavigate={onNavigate} recolhida={recolhida} />
        )}
        {alternar && recolhida && (
          <Tooltip label="Expandir menu (Ctrl+B)" side="right">
            <button
              type="button"
              onClick={alternar}
              className="flex h-9 w-full items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,transform] duration-150 hover:bg-accent hover:text-foreground active:scale-[.97]"
              aria-label="Expandir menu"
            >
              <AlternarIcone className="size-4" />
            </button>
          </Tooltip>
        )}
        <EuBotao recolhida={recolhida} />
      </div>
    </div>
  );
}

function ItemNav({
  item,
  onNavigate,
  recolhida,
}: {
  item: NavItem;
  onNavigate?: () => void;
  recolhida?: boolean;
}) {
  const Icon = item.icon;
  const { pathname } = useLocation();
  const navegarSuave = useNavegarSuave();
  const aberto =
    !recolhida &&
    !!item.filhos &&
    item.filhos.length > 1 &&
    (pathname === item.to || pathname.startsWith(item.to + "/"));
  const preCarga = () => void preCarregar(item.to);
  // Na gaveta do celular, clique normal (a gaveta fecha pelo pathname).
  const aoClicar = (e: MouseEvent<HTMLAnchorElement>, to: string) => {
    if (onNavigate) onNavigate();
    else navegarSuave(e, to);
  };
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={(e) => aoClicar(e, item.to)}
      onMouseEnter={preCarga}
      onFocus={preCarga}
      aria-label={recolhida ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          "group relative flex h-9 items-center gap-3 rounded-md px-3 text-xs transition-[color,background-color] duration-150",
          isActive
            ? "bg-primary/[0.08] text-primary font-semibold"
            : "text-foreground hover:bg-accent/70",
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      <span className={cn("truncate transition-opacity duration-150", recolhida && "opacity-0")}>{item.label}</span>
    </NavLink>
  );
  return (
    <>
      {recolhida ? (
        <Tooltip label={item.label} side="right" delay={150}>
          {link}
        </Tooltip>
      ) : (
        link
      )}
      {aberto && (
        <div className="ml-[22px] mt-0.5 mb-1 space-y-0.5 border-l border-border pl-3 animate-in fade-in-0 slide-in-from-top-1 duration-150">
          {item.filhos!.map((f) => (
            <NavLink
              key={f.to}
              to={f.to}
              end={f.end}
              onClick={(e) => aoClicar(e, f.to)}
              onMouseEnter={() => void preCarregar(f.to)}
              onFocus={() => void preCarregar(f.to)}
              className={({ isActive }) =>
                cn(
                  "flex h-8 items-center rounded-md px-2.5 text-xs transition-[color,background-color] duration-150",
                  isActive
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/70",
                )
              }
            >
              {f.label}
            </NavLink>
          ))}
        </div>
      )}
    </>
  );
}

/** Quem está logado: nome, cargo, e-mail, tema e "Sair". */
function EuBotao({ compacto, recolhida }: { compacto?: boolean; recolhida?: boolean }) {
  const { eu, sessao, sair } = useEu();
  const { theme, setTheme } = useTheme();
  const [aberto, setAberto] = useState(false);
  const soAvatar = compacto || recolhida;
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-3 rounded-md text-left transition-[background-color,transform] duration-150 hover:bg-accent/70 active:scale-[.98] data-[state=open]:bg-accent/70",
            compacto ? "p-1 -mr-1 rounded-full" : recolhida ? "w-full justify-center py-1.5" : "w-full px-2 py-1.5",
          )}
          aria-label="Sua conta"
        >
          {eu ? (
            <ColaboradorAvatar nome={eu.nome} cor={eu.cor} size={compacto ? "xs" : "sm"} />
          ) : (
            <LogoMark className="size-7" />
          )}
          {!soAvatar && (
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-semibold truncate">{eu?.nome}</span>
              <span className="block text-2xs text-muted-foreground truncate">{eu?.cargo ?? ""}</span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={compacto ? "end" : "start"}
        side={compacto ? "bottom" : recolhida ? "right" : "top"}
        className="w-64 p-1.5"
      >
        <div className="px-2.5 pt-2 pb-2.5">
          <p className="text-sm font-semibold truncate">{eu?.nome}</p>
          <p className="text-2xs text-muted-foreground truncate">{eu?.email ?? sessao?.user.email}</p>
          {eu?.cargo && <p className="text-2xs text-muted-foreground">{eu.cargo}</p>}
        </div>
        <div className="border-t border-divider pt-1.5 pb-1">
          <p className="px-2.5 pb-1 text-2xs text-muted-foreground">Aparência</p>
          {(
            [
              { valor: "light", rotulo: "Claro", Icone: Sun },
              { valor: "dark", rotulo: "Escuro", Icone: Moon },
            ] as const
          ).map(({ valor, rotulo, Icone }) => (
            <button
              key={valor}
              type="button"
              onClick={() => setTheme(valor)}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 h-9 text-xs transition-colors hover:bg-accent"
              aria-pressed={theme === valor}
            >
              <Icone className="size-4 text-muted-foreground" />
              <span className="flex-1 text-left">{rotulo}</span>
              {theme === valor && <Check className="size-4 text-primary" />}
            </button>
          ))}
        </div>
        <div className="border-t border-divider pt-1">
          <button
            type="button"
            onClick={() => {
              setAberto(false);
              void sair();
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 h-9 text-xs transition-colors hover:bg-accent"
          >
            <LogOut className="size-4 text-muted-foreground" />
            Sair
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
