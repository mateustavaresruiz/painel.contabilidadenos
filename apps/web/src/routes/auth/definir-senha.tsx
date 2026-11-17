import { KeyRound, LogOut } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Logo } from "@/components/logo";
import { FormSenhaNova } from "@/components/senha-form";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import { useEu } from "@/lib/colaborador";
import { sessaoPorLink } from "@/lib/senha";
import { toast } from "@/lib/toast";

/** Só caminho interno (evita redirecionar para outro site pelo ?next=). */
function destinoSeguro(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/auth/") ? next : "/";
}

/**
 * "Crie sua senha" (docs/LOGIN.md > Senha). Chega-se aqui:
 *  - no primeiro acesso: o link de acesso gerado em Equipe (ou o "só com o
 *    e-mail") abre a sessão e o AuthGate manda para cá quem ainda não tem senha;
 *  - pelo link "Redefinir senha" de Equipe (/auth/callback?type=recovery);
 *  - por "Trocar senha" no menu da conta, se a pessoa preferir a página.
 * Fica fora do menu do painel, mas exige sessão e Colaborador ativo (AuthGate
 * com exigirSenha=false, para não mandar para si mesma).
 */
export function DefinirSenhaPage() {
  const { eu, sessao, sair } = useEu();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const destino = destinoSeguro(params.get("next"));
  const redefinir = params.get("motivo") === "redefinir";
  const primeira = eu?.senhaDefinidaEm === null;
  // Primeiro acesso não tem "agora não": o painel vai deixar de aceitar entrada sem senha.
  const obrigatoria = primeira && !redefinir;
  const pedirAtual = !sessaoPorLink(sessao);
  const titulo = redefinir ? "Crie uma senha nova" : primeira ? "Crie sua senha" : "Trocar a senha";
  usePageTitle(titulo);
  const primeiroNome = eu?.nome?.split(" ")[0];

  return (
    <div className="min-h-dvh grid place-items-center bg-background px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-card sm:p-8 animate-fade-up space-y-6">
        <Logo className="h-12" />
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-title-md">
            <KeyRound className="size-5 text-primary" strokeWidth={1.5} aria-hidden />
            {titulo}
          </h1>
          <p className="text-sm text-muted-foreground">
            {redefinir
              ? "A senha antiga deixa de valer assim que você salvar a nova."
              : primeira
                ? `${primeiroNome ? `Olá, ${primeiroNome}! ` : ""}Daqui em diante você entra no painel com o seu e-mail e esta senha.`
                : "Escolha uma senha que você não usa em nenhum outro site."}
          </p>
          {(eu?.email ?? sessao?.user.email) && (
            <p className="text-xs text-muted-foreground">
              E-mail de acesso: <span className="font-semibold text-foreground">{eu?.email ?? sessao?.user.email}</span>
            </p>
          )}
        </div>

        <FormSenhaNova
          pedirAtual={pedirAtual}
          autoFocus
          rotuloBotao={primeira || redefinir ? "Salvar senha e entrar" : "Salvar senha nova"}
          onSucesso={() => {
            toast.success(
              primeira || redefinir
                ? "Senha salva. Da próxima vez, entre com seu e-mail e esta senha."
                : "Senha trocada. Os outros aparelhos conectados vão pedir a senha nova.",
            );
            navigate(destino, { replace: true });
          }}
          rodape={
            obrigatoria ? (
              <Button type="button" variant="ghost" onClick={() => void sair()} className="mr-auto">
                <LogOut />
                Sair
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => navigate(destino, { replace: true })} className="mr-auto">
                Agora não
              </Button>
            )
          }
        />

        <p className="border-t border-divider pt-4 text-xs text-muted-foreground">
          Ninguém do escritório vai pedir a sua senha. Se esquecer, peça a um administrador um link para redefinir
          (Equipe &gt; Redefinir senha).
        </p>
      </div>
    </div>
  );
}
