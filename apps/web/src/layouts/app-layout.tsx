import { Menu } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { Logo, LogoMark } from "@/components/logo";
import { QuemSouEuDialog } from "@/components/quem-sou-eu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { NAV_APP, type NavItem } from "@/layouts/app-nav";
import { useEu } from "@/lib/colaborador";
import { cn } from "@/lib/utils";

/**
 * Casca do painel: sidebar fixa no desktop, gaveta no celular. Sem login:
 * no rodapé fica "quem é você" (colaborador escolhido neste computador),
 * trocável a qualquer momento.
 */
export function AppLayout() {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Radix não fecha sozinho quando só o pathname muda.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // O Atendimento ocupa a altura toda e tem scroll próprio nas colunas.
  const telaCheia = location.pathname === "/whatsapp" || location.pathname === "/whatsapp/";

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:grid md:grid-cols-[248px_1fr] md:grid-rows-[minmax(0,1fr)]">
      {/* Barra de topo — só no celular. Soma o entalhe do iPhone. */}
      <header className="md:hidden flex items-center justify-between border-b border-border barra-fixa px-4 pt-safe-t h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="grid place-items-center size-9 rounded-md hover:bg-accent/60 transition-colors -ml-2"
          aria-label="Abrir menu"
        >
          <Menu className="size-5" />
        </button>
        <Link to="/" className="inline-flex h-8">
          <Logo className="h-8" />
        </Link>
        <EuBotao compacto />
      </header>

      <aside className="hidden md:flex border-r border-border bg-background flex-col min-h-0">
        <Sidebar />
      </aside>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" showCloseButton overlayClassName="md:hidden" className="md:hidden pl-safe-l">
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <SheetDescription className="sr-only">Páginas do painel.</SheetDescription>
          <Sidebar onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>

      <main id="main-content" className="flex-1 min-h-0 min-w-0 flex flex-col">
        <div
          key={location.pathname}
          className={cn(
            "flex-1 min-h-0 animate-route-fade",
            telaCheia ? "overflow-hidden flex flex-col" : "overflow-auto overscroll-contain",
          )}
        >
          <Suspense fallback={null}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-5 py-4 border-b shrink-0">
        <NavLink to="/" end onClick={onNavigate} className="flex items-center gap-2">
          <Logo className="h-11" />
        </NavLink>
        <p className="mt-1 text-2xs text-muted-foreground">Painel interno</p>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-0.5">
        {NAV_APP.map((item) => (
          <ItemNav key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="p-3 border-t space-y-1 shrink-0">
        <EuBotao />
        <ThemeToggle variant="full" />
      </div>
    </div>
  );
}

function ItemNav({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  const { pathname } = useLocation();
  const aberto = !!item.filhos && (pathname === item.to || pathname.startsWith(item.to + "/"));
  return (
    <>
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-xs transition-colors",
          isActive
            ? "bg-primary/[0.08] text-primary font-semibold"
            : "text-foreground hover:bg-accent",
        )
      }
    >
      <Icon className="size-4" />
      {item.label}
    </NavLink>
    {aberto && (
      <div className="ml-7 mt-0.5 mb-1 space-y-0.5 border-l pl-2">
        {item.filhos!.map((f) => (
          <NavLink
            key={f.to}
            to={f.to}
            end={f.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "block rounded-md px-2.5 py-1.5 text-xs transition-colors",
                isActive ? "text-primary font-medium bg-primary/5" : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
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

/** Quem está usando este computador + botão de trocar. */
function EuBotao({ compacto }: { compacto?: boolean }) {
  const { eu } = useEu();
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={cn(
          "flex items-center gap-3 rounded-md text-left transition-colors hover:bg-accent/60",
          compacto ? "p-1 -mr-1" : "w-full px-2 py-2",
        )}
        title="Trocar de pessoa"
      >
        {eu ? (
          <ColaboradorAvatar nome={eu.nome} cor={eu.cor} size={compacto ? "xs" : "sm"} />
        ) : (
          <LogoMark className="size-7" />
        )}
        {!compacto && (
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium truncate">{eu?.nome ?? "Quem é você?"}</span>
            <span className="block text-2xs text-muted-foreground truncate">
              {eu?.cargo ? `${eu.cargo} · ` : ""}trocar
            </span>
          </span>
        )}
      </button>
      <QuemSouEuDialog open={aberto} onOpenChange={setAberto} />
    </>
  );
}
