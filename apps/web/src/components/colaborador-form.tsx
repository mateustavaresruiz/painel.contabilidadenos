import { Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CORES_COLABORADOR, type Colaborador } from "@/lib/colaborador";
import { useEhAdmin } from "@/lib/modulos";
import { msgErro } from "@/lib/erro";
import { maskTelefone } from "@/lib/masks";
import { useSalvarColaborador } from "@/lib/queries/denos";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Formulário de colaborador (cadastro inicial, Colaboradores e edição). */
export function ColaboradorForm({
  inicial,
  onSalvo,
  onCancelar,
  textoBotao,
  compacto,
}: {
  inicial?: Colaborador | null;
  onSalvo?: (c: { id: string }) => void;
  onCancelar?: () => void;
  textoBotao?: string;
  /** Só nome, cargo e cor (primeiro acesso). */
  compacto?: boolean;
}) {
  const salvar = useSalvarColaborador();
  // Só admin troca papel (portão de tela; sem login, ver lib/modulos.ts).
  const ehAdmin = useEhAdmin();
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [email, setEmail] = useState(inicial?.email ?? "");
  const [telefone, setTelefone] = useState(inicial?.telefone ? maskTelefone(inicial.telefone) : "");
  const [cargo, setCargo] = useState(inicial?.cargo ?? "");
  const [cor, setCor] = useState(inicial?.cor ?? CORES_COLABORADOR[0]!);
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [papel, setPapel] = useState<"admin" | "atendente">(inicial?.papel ?? "atendente");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (nome.trim().length < 2) {
      toast.error("Informe o nome.");
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("E-mail inválido.");
      return;
    }
    try {
      const r = await salvar.mutateAsync({
        id: inicial?.id,
        input: { nome, email, telefone, cargo, cor, ativo, papel: compacto || !ehAdmin ? undefined : papel },
      });
      onSalvo?.({ id: r.id });
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="flex items-center gap-3">
        <ColaboradorAvatar nome={nome || "?"} cor={cor} size="md" />
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="col-nome">
            Nome <span className="text-destructive">*</span>
          </Label>
          <Input
            id="col-nome"
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Ana Souza"
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="col-cargo">Cargo</Label>
          <Input
            id="col-cargo"
            value={cargo}
            onChange={(e) => setCargo(e.target.value)}
            placeholder="Ex.: Fiscal, DP, Atendimento"
          />
        </div>
        {!compacto && (
          <div className="space-y-1.5">
            <Label htmlFor="col-tel">Telefone</Label>
            <Input
              id="col-tel"
              inputMode="tel"
              value={telefone}
              onChange={(e) => setTelefone(maskTelefone(e.target.value))}
              placeholder="(17) 99999-9999"
            />
          </div>
        )}
        {!compacto && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="col-email">E-mail</Label>
            <Input
              id="col-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Cor</Label>
        <div className="flex flex-wrap gap-2">
          {CORES_COLABORADOR.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCor(c)}
              className={cn(
                "size-7 rounded-full grid place-items-center ring-offset-2 ring-offset-background transition",
                cor === c && "ring-2 ring-foreground/60",
              )}
              style={{ backgroundColor: c }}
              aria-label={"Cor " + c}
              aria-pressed={cor === c}
            >
              {cor === c && <Check className="size-3.5 text-white" />}
            </button>
          ))}
        </div>
      </div>
      {!compacto && ehAdmin && (
        <div className="space-y-1.5">
          <Label>Papel</Label>
          <div className="inline-flex rounded-full border p-1" role="radiogroup" aria-label="Papel">
            {(
              [
                ["atendente", "Atendente"],
                ["admin", "Administrador"],
              ] as const
            ).map(([v, rotulo]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={papel === v}
                onClick={() => setPapel(v)}
                className={cn(
                  "rounded-full px-3.5 py-1 text-xs transition-colors",
                  papel === v ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>
          <p className="text-2xs text-muted-foreground">
            Administrador vê Configurações (módulos, integrações e sistema).
          </p>
        </div>
      )}
      {!compacto && inicial && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
            className="size-4 accent-[var(--primary)]"
          />
          Ativo (aparece no "Quem é você?" e nas listas de responsável)
        </label>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {onCancelar && (
          <Button type="button" variant="ghost" onClick={onCancelar} disabled={salvar.isPending}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? <Loader2 className="animate-spin" /> : null}
          {textoBotao ?? (inicial ? "Salvar" : "Cadastrar")}
        </Button>
      </div>
    </form>
  );
}
