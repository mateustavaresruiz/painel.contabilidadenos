import { Lock, LogOut, UserX } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";

import { Logo } from "@/components/logo";
import { CarregandoMarca } from "@/components/marca-hexagono";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useEu } from "@/lib/colaborador";

function Carregando() {
  return (
    <CarregandoMarca className="h-dvh bg-background" rotulo="Abrindo o painel" />
  );
}

/**
 * Porteiro do painel: sem sessão vai para /login (guardando para onde ia);
 * com sessão mas sem Colaborador ativo amarrado, mostra "acesso não liberado".
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { sessao, eu, carregando } = useEu();
  const { pathname, search } = useLocation();
  if (carregando) return <Carregando />;
  if (!sessao) {
    const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return <Navigate to={`/login${next}`} replace />;
  }
  if (!eu) return <AcessoNaoLiberado email={sessao.user.email ?? null} />;
  return <>{children}</>;
}

function AcessoNaoLiberado({ email }: { email: string | null }) {
  const { sair } = useEu();
  return (
    <div className="min-h-dvh grid place-items-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 sm:p-8 animate-fade-up space-y-5">
        <Logo className="h-12" />
        <div className="space-y-2">
          <h1 className="text-title-md flex items-center gap-2">
            <UserX className="size-5 text-muted-foreground" />
            Acesso não liberado
          </h1>
          <p className="text-sm text-muted-foreground">
            {email ? (
              <>
                O e-mail <strong className="text-foreground">{email}</strong> entrou, mas não está ativo na equipe do
                painel.
              </>
            ) : (
              "Você entrou, mas não está ativo na equipe do painel."
            )}{" "}
            Peça a um administrador do escritório para liberar seu acesso em Equipe.
          </p>
        </div>
        <Button variant="outline" onClick={() => void sair()}>
          <LogOut />
          Sair
        </Button>
      </div>
    </div>
  );
}

/** Página que exige uma permissão do cargo (ou uma de várias). */
export function PermissaoGate({ permissao, children }: { permissao: string | string[]; children: ReactNode }) {
  const { tem } = useEu();
  const lista = Array.isArray(permissao) ? permissao : [permissao];
  if (lista.some((p) => tem(p))) return <>{children}</>;
  return <SemAcesso />;
}

export function SemAcesso() {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <EmptyState
        icon={Lock}
        title="Sem acesso"
        description="Seu cargo não tem permissão para esta página. Se precisar, peça a um administrador em Equipe, aba Cargos."
        action={
          <Button asChild variant="outline">
            <Link to="/">Voltar ao início</Link>
          </Button>
        }
      />
    </div>
  );
}
