// Campos de senha (entrar, criar e trocar) e o formulário de senha nova.
// Regras e mensagens em lib/senha.ts; quem confere de verdade é o Auth.

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eye, EyeOff } from "lucide-react";
import { forwardRef, useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input, type InputProps } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEu } from "@/lib/colaborador";
import { avaliarSenha, erroDaSenhaNova, marcarSenhaDefinida } from "@/lib/senha";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/**
 * Input de senha com "mostrar/esconder". O botão fica dentro do campo, com
 * alvo de 40px (44px no toque) e estado anunciado (aria-pressed).
 */
export const CampoSenha = forwardRef<HTMLInputElement, Omit<InputProps, "type">>(function CampoSenha(
  { className, ...props },
  ref,
) {
  const [ver, setVer] = useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={ver ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn("pr-12", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVer((v) => !v)}
        aria-label={ver ? "Esconder a senha" : "Mostrar a senha"}
        aria-pressed={ver}
        title={ver ? "Esconder a senha" : "Mostrar a senha"}
        className="absolute right-1 top-1/2 grid size-10 toque:size-11 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {ver ? <EyeOff className="size-[18px]" strokeWidth={1.5} /> : <Eye className="size-[18px]" strokeWidth={1.5} />}
      </button>
    </div>
  );
});

const COR_NIVEL = ["bg-destructive", "bg-destructive", "bg-warning", "bg-primary", "bg-success"] as const;

/** Barrinhas de força + rótulo + dica (só informa; quem bloqueia é o erro). */
export function MedidorSenha({ senha, contexto, id }: { senha: string; contexto: (string | null)[]; id?: string }) {
  const a = avaliarSenha(senha, contexto);
  if (!senha) {
    return (
      <p id={id} className="text-xs text-muted-foreground">
        Pelo menos 10 caracteres. Uma frase curta funciona bem, ex.: &quot;cafe com leite as 8h&quot;.
      </p>
    );
  }
  return (
    <div id={id} className="space-y-1.5" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              a.nivel >= n || (a.nivel === 0 && n === 1) ? COR_NIVEL[a.nivel] : "bg-muted",
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Força: {a.rotulo}</span>
        {a.erro ? ` · ${a.erro}` : a.dica ? ` · ${a.dica}` : ""}
      </p>
    </div>
  );
}

/**
 * Senha nova (+ confirmação, + atual quando o Auth exige). Usado em
 * "Crie sua senha" (primeiro acesso / redefinir) e em "Trocar senha".
 * O Auth encerra as outras sessões da pessoa ao trocar a senha.
 */
export function FormSenhaNova({
  pedirAtual,
  rotuloBotao,
  onSucesso,
  rodape,
  autoFocus,
}: {
  /** Sessão aberta com senha: o Auth exige a atual para trocar. */
  pedirAtual: boolean;
  rotuloBotao: string;
  onSucesso: () => void;
  /** Ações extras ao lado do botão (Cancelar, Sair). */
  rodape?: ReactNode;
  autoFocus?: boolean;
}) {
  const { eu, sessao } = useEu();
  const qc = useQueryClient();
  const ids = useId();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const email = eu?.email ?? sessao?.user.email ?? null;
  const contexto = [email, eu?.nome ?? null];
  const avaliacao = avaliarSenha(nova, contexto);
  const erroNova = tentou ? (nova ? avaliacao.erro : "Digite a senha nova.") : null;
  const erroConfirma = tentou && confirma !== nova ? "As duas senhas não são iguais." : null;
  const erroAtual = tentou && pedirAtual && !atual ? "Digite a sua senha atual." : null;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setTentou(true);
    setErro(null);
    if (!nova || avaliacao.erro || confirma !== nova || (pedirAtual && !atual)) return;
    setSalvando(true);
    const { error } = await supabase.auth.updateUser(
      pedirAtual ? { password: nova, current_password: atual } : { password: nova },
    );
    setSalvando(false);
    if (error) {
      setErro(erroDaSenhaNova(error as Parameters<typeof erroDaSenhaNova>[0]));
      return;
    }
    if (sessao?.user.id) marcarSenhaDefinida(sessao.user.id);
    void qc.invalidateQueries({ queryKey: ["eu"] });
    void qc.invalidateQueries({ queryKey: ["colaboradores"] });
    setAtual("");
    setNova("");
    setConfirma("");
    setTentou(false);
    onSucesso();
  }

  return (
    <form onSubmit={salvar} className="space-y-5" noValidate>
      {/* Para o gerenciador de senhas saber de qual conta é a senha nova. */}
      <input type="email" name="username" autoComplete="username" value={email ?? ""} readOnly hidden />

      {pedirAtual && (
        <div className="space-y-2">
          <Label htmlFor={`${ids}-atual`}>Senha atual</Label>
          <CampoSenha
            id={`${ids}-atual`}
            autoComplete="current-password"
            autoFocus={autoFocus}
            value={atual}
            onChange={(e) => setAtual(e.target.value)}
            aria-invalid={!!erroAtual}
            aria-describedby={erroAtual ? `${ids}-atual-erro` : undefined}
          />
          {erroAtual && (
            <p id={`${ids}-atual-erro`} className="text-xs text-destructive">
              {erroAtual}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={`${ids}-nova`}>{pedirAtual ? "Senha nova" : "Senha"}</Label>
        <CampoSenha
          id={`${ids}-nova`}
          autoComplete="new-password"
          autoFocus={autoFocus && !pedirAtual}
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          aria-invalid={!!erroNova}
          aria-describedby={`${ids}-forca`}
          minLength={10}
        />
        <MedidorSenha senha={nova} contexto={contexto} id={`${ids}-forca`} />
        {erroNova && !nova && <p className="text-xs text-destructive">{erroNova}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${ids}-confirma`}>Repita a senha</Label>
        <CampoSenha
          id={`${ids}-confirma`}
          autoComplete="new-password"
          value={confirma}
          onChange={(e) => setConfirma(e.target.value)}
          aria-invalid={!!erroConfirma}
          aria-describedby={erroConfirma ? `${ids}-confirma-erro` : undefined}
        />
        {erroConfirma && (
          <p id={`${ids}-confirma-erro`} className="text-xs text-destructive">
            {erroConfirma}
          </p>
        )}
      </div>

      {erro && (
        <p role="alert" className="flex items-start gap-1.5 rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {erro}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {rodape}
        <Button type="submit" loading={salvando} className="max-sm:w-full">
          {rotuloBotao}
        </Button>
      </div>
    </form>
  );
}
