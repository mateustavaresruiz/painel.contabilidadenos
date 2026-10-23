import { Check, LogOut, Menu, UserRound, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from "lucide-react";
import { Suspense, useCallback, useEffect, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { BuscaGlobal, useAtalhoBusca } from "@/components/busca-global";
import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { Logo, LogoMark } from "@/components/logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { OfflineBanner } from "@/components/ui/query-error";
import { PaginaSkeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { NAV_APP, NAV_CONFIGURACOES, NAV_EM_BREVE, type NavItem } from "@/layouts/app-nav";
import { useAplicarEstilo, type Estilo } from "@/lib/aparencia";
import { useEu } from "@/lib/colaborador";
import { useContadorCertificados, useContadorChamados, useContadorWhatsapp } from "@/lib/queries/contadores";
import { useModulos } from "@/lib/modulos";
import { useAnunciarPresencaPainel } from "@/lib/presenca-painel";
import { useTheme } from "@/lib/use-theme";
import { useTecladoVirtual } from "@/lib/teclado-virtual";
import { cn } from "@/lib/utils";
import { preCarregar, preCarregarOcioso } from "@/routes/paginas";

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
  const estilo = useAplicarEstilo();
  const [buscaAberta, setBuscaAberta] = useState(false);
  const abrirBusca = useCallback(() => setBuscaAberta(true), []);
  useAtalhoBusca(abrirBusca);
  // "Online agora" no perfil da equipe (presença do Realtime, nada no banco).
  useAnunciarPresencaPainel(useEu().euId);

  // Radix não fecha sozinho quando só o pathname muda.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Pré-carga ociosa das páginas do menu: o primeiro clique já abre na hora
  // (desligada em rede econômica, ver routes/paginas.ts).
  const caminhosMenu = NAV_APP.filter((i) => !i.modulo || ativo(i.modulo))
    .flatMap((i) => [i.to, ...(i.filhos?.map((f) => f.to) ?? [])])
    .join(",");
  useEffect(() => preCarregarOcioso(caminhosMenu.split(",")), [caminhosMenu]);

  // Quem rola é o contêiner do conteúdo, nunca o documento (index.css).
  useEffect(() => {
    document.documentElement.classList.add("casca-app");
    return () => document.documentElement.classList.remove("casca-app");
  }, []);
  // iOS: a casca acompanha a área visível quando o teclado abre.
  useTecladoVirtual();

  // O Atendimento ocupa a altura toda e tem scroll próprio nas colunas.
  const telaCheia = location.pathname === "/whatsapp" || location.pathname === "/whatsapp/";
  // Conversa aberta no celular: a conversa tem o próprio cabeçalho (com
  // Voltar), então a barra do app sai e sobra tela para as mensagens.
  const conversaAberta = telaCheia && new URLSearchParams(location.search).has("chat");

  return (
    <div className="relative top-[var(--vv-topo,0px)] flex h-[var(--vv-altura,100dvh)] flex-col overflow-hidden lg:flex-row">
      {/* Teclado: o primeiro Tab pula o menu e cai no conteúdo. */}
      <a
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          const alvo = document.getElementById("main-content");
          alvo?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-card"
      >
        Pular para o conteúdo
      </a>
      {/* Barra de topo: só no celular. Soma o entalhe do iPhone (e as laterais deitado). */}
      <header
        className={cn(
          "lg:hidden sticky top-0 z-30 flex items-center justify-between border-b border-border barra-fixa pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-safe-t h-[calc(4rem+env(safe-area-inset-top))] shrink-0",
          conversaAberta && "compacto:hidden",
        )}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="grid place-items-center size-11 rounded-full transition-[background-color,transform] duration-150 hover:bg-accent/60 active:scale-[.97] -ml-2.5"
          aria-label="Abrir menu"
        >
          <Menu className="size-5" />
        </button>
        <Link to="/" className="inline-flex h-11">
          <Logo className="h-11" />
        </Link>
        <div className="-mr-1.5 flex items-center gap-0.5">
          <button
            type="button"
            onClick={abrirBusca}
            className="grid place-items-center size-11 rounded-full text-muted-foreground transition-[background-color,transform] duration-150 hover:bg-accent/60 active:scale-[.97]"
            aria-label="Buscar"
          >
            <Search className="size-5" />
          </button>
          <EuBotao compacto />
        </div>
      </header>

      <aside
        className={cn(
          "hidden lg:flex shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex-col min-h-0 overflow-hidden",
          "transition-[width] duration-200 ease-brand motion-reduce:transition-none",
          recolhida ? "w-[72px]" : "w-[264px]",
        )}
        data-recolhida={recolhida || undefined}
      >
        <Sidebar recolhida={recolhida} alternar={alternar} estilo={estilo} onBuscar={abrirBusca} />
      </aside>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" showCloseButton overlayClassName="lg:hidden" className="lg:hidden pl-safe-l bg-sidebar text-sidebar-foreground border-sidebar-border">
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <SheetDescription className="sr-only">Páginas do painel.</SheetDescription>
          <Sidebar onNavigate={() => setDrawerOpen(false)} estilo={estilo} />
        </SheetContent>
      </Sheet>

      <main id="main-content" tabIndex={-1} className="outline-none flex-1 min-h-0 min-w-0 flex flex-col pl-safe-l pr-safe-r lg:pl-0 [view-transition-name:conteudo]">
        <OfflineBanner />
        <div
          key={location.pathname}
          className={cn(
            "flex-1 min-h-0 animate-page-enter",
            telaCheia
              ? "overflow-hidden flex flex-col"
              : "overflow-auto overscroll-contain pb-safe-b [container-type:inline-size]",
          )}
        >
          <Suspense fallback={telaCheia ? null : <PaginaSkeleton />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <BuscaGlobal aberto={buscaAberta} onOpenChange={setBuscaAberta} />
    </div>
  );
}

function Sidebar({
  onNavigate,
  recolhida = false,
  alternar,
  estilo: _estilo,
  onBuscar,
}: {
  onNavigate?: () => void;
  recolhida?: boolean;
  alternar?: () => void;
  estilo: Estilo;
  /** Só no menu do desktop: o botão "Buscar (Ctrl+K)" abaixo da logo. */
  onBuscar?: () => void;
}) {
  const branca = false; // menu sempre branco; logo azul
  const { ativo } = useModulos();
  const { tem } = useEu();
  const pode = (ps?: string[]) => !ps || ps.some((p) => tem(p));
  // Módulo desligado em Configurações some do menu; item sem permissão também.
  const itens = NAV_APP.filter((i) => (!i.modulo || ativo(i.modulo)) && pode(i.permissao)).map((i) =>
    i.filhos ? { ...i, filhos: i.filhos.filter((f) => pode(f.permissao)) } : i,
  );
  // Configurações aparece para quem tem qualquer permissão que a página aceita;
  // quem não administra cai direto na aba que pode usar.
  const podeConexoes = tem("whatsapp.conexoes") && ativo("whatsapp");
  const verConfiguracoes = tem("configuracoes.gerenciar") || podeConexoes || tem("auditoria.ver");
  const configuracoes = tem("configuracoes.gerenciar")
    ? NAV_CONFIGURACOES
    : { ...NAV_CONFIGURACOES, to: podeConexoes ? "/configuracoes?tab=conexoes" : "/configuracoes?tab=auditoria" };
  const emBreve = NAV_EM_BREVE.filter((i) => pode(i.permissao));
  const AlternarIcone = recolhida ? PanelLeftOpen : PanelLeftClose;
  const { data: contWhats } = useContadorWhatsapp(itens.some((i) => i.to === "/whatsapp"));
  const { data: contChamados } = useContadorChamados(itens.some((i) => i.to === "/chamados"));
  const { data: contCertificados } = useContadorCertificados(itens.some((i) => i.to === "/certificados"));
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={cn("shrink-0 flex items-center mb-1", recolhida ? "flex-col justify-center gap-3 px-3 pt-5 pb-3" : "h-[92px] pl-5 pr-3 gap-2")}>
        <NavLink
          to="/"
          end
          onClick={onNavigate}
          className={cn("flex min-w-0 items-center gap-2.5", recolhida ? "justify-center" : "flex-1")}
          aria-label="Início"
        >
          {recolhida ? (
            <LogoMark className="size-11" branca={branca} />
          ) : (
            <span className="flex min-w-0 flex-col">
              <Logo className="h-12" branca={branca} />
            </span>
          )}
        </NavLink>
        {alternar && (
          <Tooltip label={recolhida ? "Expandir menu (Ctrl+B)" : "Recolher menu (Ctrl+B)"} side="right">
            <button
              type="button"
              onClick={alternar}
              className={cn(
                "grid shrink-0 place-items-center rounded-lg text-sidebar-muted transition-[color,background-color,transform] duration-150 hover:bg-sidebar-hover hover:text-sidebar-foreground active:scale-[.97]",
                recolhida ? "size-10 border border-sidebar-border bg-card text-primary shadow-card hover:text-primary" : "size-8",
              )}
              aria-label={recolhida ? "Expandir menu" : "Recolher menu"}
            >
              <AlternarIcone className="size-4" />
            </button>
          </Tooltip>
        )}
      </div>
      {onBuscar && (
        <div className={cn("shrink-0 pb-2", recolhida ? "px-3 flex justify-center" : "px-3")}>
          {recolhida ? (
            <Tooltip label="Buscar (Ctrl+K)" side="right">
              <button
                type="button"
                onClick={onBuscar}
                className="grid size-10 place-items-center rounded-lg text-sidebar-muted transition-[color,background-color,transform] duration-150 hover:bg-sidebar-hover hover:text-sidebar-foreground active:scale-[.97]"
                aria-label="Buscar (Ctrl+K)"
              >
                <Search className="size-[18px]" />
              </button>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={onBuscar}
              className="flex h-10 w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-card/70 px-3 text-sm text-sidebar-muted transition-[color,background-color,transform] duration-150 hover:bg-sidebar-hover hover:text-sidebar-foreground active:scale-[.97]"
            >
              <Search className="size-4 shrink-0" />
              <span className="flex-1 text-left">Buscar</span>
              <kbd className="rounded-md border border-sidebar-border px-1.5 py-0.5 font-sans text-2xs">Ctrl K</kbd>
            </button>
          )}
        </div>
      )}
      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pb-3 space-y-0.5" aria-label="Páginas">
        {itens.map((item) => (
          <ItemNav
            key={item.to}
            item={item}
            onNavigate={onNavigate}
            recolhida={recolhida}
            contador={
              item.to === "/whatsapp"
                ? contWhats
                : item.to === "/chamados"
                  ? contChamados
                  : item.to === "/certificados"
                    ? contCertificados
                    : undefined
            }
          />
        ))}
        {emBreve.length > 0 && (
          <>
            {recolhida ? (
              <div aria-hidden className="mx-2 my-2 border-t border-sidebar-border" />
            ) : (
              <p className="px-1.5 pt-4 pb-1 text-2xs font-semibold uppercase tracking-wide text-sidebar-muted">Em breve</p>
            )}
            {emBreve.map((item) => (
              <ItemNav key={item.to} item={item} onNavigate={onNavigate} recolhida={recolhida} />
            ))}
          </>
        )}
      </nav>
      <div className="px-3 pb-3 pt-2 border-t border-sidebar-border space-y-0.5 shrink-0">
        {verConfiguracoes && (
          <ItemNav item={configuracoes} onNavigate={onNavigate} recolhida={recolhida} />
        )}
        {/* Conta (avatar, nome, cargo; menu com tema e Sair). Na gaveta do celular
            ela já está no cabeçalho. */}
        {!onNavigate && <EuBotao naSidebar recolhida={recolhida} />}
      </div>
    </div>
  );
}

function ItemNav({
  item,
  onNavigate,
  recolhida,
  contador,
}: {
  item: NavItem;
  onNavigate?: () => void;
  recolhida?: boolean;
  contador?: number;
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
          "group relative flex h-10 toque:h-11 items-center gap-2.5 rounded-lg px-1.5 text-xs transition-[color,background-color] duration-150",
          recolhida && "justify-center",
          isActive
            ? "bg-sidebar-active text-primary font-semibold"
            : "text-sidebar-foreground/85 hover:bg-sidebar-hover hover:text-sidebar-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Item ativo: só o azul da marca (ícone, texto, fundo e a barrinha de 3px). */}
          {isActive && (
            <span aria-hidden className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-primary" />
          )}
          <span
            className={cn(
              "relative grid size-7 shrink-0 place-items-center rounded-md transition-colors duration-150",
              isActive ? "text-primary" : "text-sidebar-muted group-hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-[18px]" />
            {recolhida && contador ? (
              <span className="absolute -right-1 -top-1 min-w-4 h-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground text-center tabular-nums ring-2 ring-sidebar">
                {contador > 99 ? "99+" : contador}
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              "flex-1 truncate transition-opacity duration-150",
              recolhida && "sr-only",
              item.emBreve && !isActive && "text-sidebar-muted",
            )}
          >
            {item.label}
          </span>
          {item.emBreve && !recolhida && (
            <span className="ml-auto mr-1 shrink-0 rounded-full border border-sidebar-border px-1.5 py-px text-[10px] font-medium leading-4 text-sidebar-muted">
              Em breve
            </span>
          )}
          {!recolhida && contador ? (
            <span
              className="ml-auto mr-1 min-w-5 h-5 rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground text-center tabular-nums"
              aria-label={`${contador} pendente${contador > 1 ? "s" : ""}`}
            >
              {contador > 99 ? "99+" : contador}
            </span>
          ) : null}
        </>
      )}
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
        <div className="ml-[20px] mt-0.5 mb-1 space-y-0.5 border-l border-sidebar-border pl-3 animate-in fade-in-0 slide-in-from-top-1 duration-150">
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
                  "flex h-8 toque:h-11 items-center rounded-md px-2.5 text-xs transition-[color,background-color] duration-150",
                  isActive
                    ? "text-sidebar-foreground font-semibold bg-sidebar-hover"
                    : "text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-hover",
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
function EuBotao({ compacto, recolhida, naSidebar, comNome }: { compacto?: boolean; recolhida?: boolean; naSidebar?: boolean; comNome?: boolean }) {
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
            "flex items-center gap-3 rounded-md text-left transition-[background-color,transform] duration-150 active:scale-[.98]",
            naSidebar ? "hover:bg-sidebar-hover data-[state=open]:bg-sidebar-hover" : "hover:bg-accent/70 data-[state=open]:bg-accent/70",
            compacto && comNome ? "py-1 pl-1 pr-3 rounded-full gap-2.5" : compacto ? "p-1 -mr-1 rounded-full max-lg:size-11 max-lg:justify-center max-lg:p-0 max-lg:mr-0" : recolhida ? "w-full justify-center py-1.5" : "w-full px-2 py-1.5",
          )}
          aria-label="Sua conta"
        >
          {eu ? (
            <ColaboradorAvatar nome={eu.nome} cor={eu.cor} size={compacto && !comNome ? "xs" : "sm"} />
          ) : (
            <LogoMark className="size-7" />
          )}
          {comNome && (
            <span className="hidden lg:block text-xs font-semibold max-w-[160px] truncate">{eu?.nome?.split(" ")[0]}</span>
          )}
          {!soAvatar && (
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-semibold truncate">{eu?.nome}</span>
              <span className="block text-2xs text-sidebar-muted truncate">{eu?.cargo ?? ""}</span>
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
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 h-9 toque:h-11 text-xs transition-colors hover:bg-accent"
              aria-pressed={theme === valor}
            >
              <Icone className="size-4 text-muted-foreground" />
              <span className="flex-1 text-left">{rotulo}</span>
              {theme === valor && <Check className="size-4 text-primary" />}
            </button>
          ))}
        </div>
        <div className="border-t border-divider pt-1">
          {eu && (
            <Link
              to={`/equipe/${eu.id}`}
              onClick={() => setAberto(false)}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 h-9 toque:h-11 text-xs transition-colors hover:bg-accent"
            >
              <UserRound className="size-4 text-muted-foreground" />
              Meu perfil
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              setAberto(false);
              void sair();
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 h-9 toque:h-11 text-xs transition-colors hover:bg-accent"
          >
            <LogOut className="size-4 text-muted-foreground" />
            Sair
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
