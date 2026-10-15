import { Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CORES_COLABORADOR, type Colaborador } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { maskTelefone } from "@/lib/masks";
import {
  useAtualizarPessoa,
  useCargos,
  useConvidar,
  type PessoaPatch,
  type ResultadoConvite,
} from "@/lib/queries/equipe";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Convidar (sem `inicial`) ou editar uma pessoa da equipe. Quem preenche é
 * quem gerencia a equipe: a pessoa só recebe o acesso e entra.
 */
export function ColaboradorForm({
  inicial,
  onSalvo,
  onConvidado,
  onCancelar,
}: {
  inicial?: Colaborador | null;
  onSalvo?: () => void;
  onConvidado?: (r: ResultadoConvite) => void;
  onCancelar?: () => void;
}) {
  const convidar = useConvidar();
  const atualizar = useAtualizarPessoa();
  const { data: cargos = [] } = useCargos();
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [email, setEmail] = useState(inicial?.email ?? "");
  const [telefone, setTelefone] = useState(inicial?.telefone ? maskTelefone(inicial.telefone) : "");
  const [cargoId, setCargoId] = useState(inicial?.cargoId ?? "");
  const [cor, setCor] = useState(inicial?.cor ?? CORES_COLABORADOR[0]!);
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const salvando = convidar.isPending || atualizar.isPending;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (nome.trim().length < 2) return toast.error("Informe o nome.");
    if (!EMAIL_RE.test(email.trim())) return toast.error("Informe um e-mail válido: é com ele que a pessoa entra.");
    if (!cargoId) return toast.error("Escolha o cargo.");
    try {
      if (!inicial) {
        const r = await convidar.mutateAsync({
          nome: nome.trim(),
          email: email.trim().toLowerCase(),
          cargoId,
          telefone: telefone.trim() || null,
          cor,
        });
        onConvidado?.(r);
        return;
      }
      const patch: PessoaPatch = {};
      if (nome.trim() !== inicial.nome) patch.nome = nome.trim();
      if (email.trim().toLowerCase() !== (inicial.email ?? "").toLowerCase()) patch.email = email.trim().toLowerCase();
      if ((telefone.trim() || null) !== (inicial.telefone ? maskTelefone(inicial.telefone) : null))
        patch.telefone = telefone.trim() || null;
      if (cor !== inicial.cor) patch.cor = cor;
      if (cargoId !== inicial.cargoId) patch.cargoId = cargoId;
      if (ativo !== inicial.ativo) patch.ativo = ativo;
      if (Object.keys(patch).length > 0) await atualizar.mutateAsync({ id: inicial.id, patch });
      onSalvo?.();
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      <div className="flex items-center gap-3">
        <ColaboradorAvatar nome={nome || "?"} cor={cor} size="md" />
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="col-nome">
            Nome <span className="text-destructive">*</span>
          </Label>
          <Input id="col-nome" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Ana Souza" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="col-email">
            E-mail de acesso <span className="text-destructive">*</span>
          </Label>
          <Input
            id="col-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@contabilidadenos.com.br"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="col-cargo">
            Cargo <span className="text-destructive">*</span>
          </Label>
          <Select value={cargoId} onValueChange={setCargoId}>
            <SelectTrigger id="col-cargo">
              <SelectValue placeholder="Escolha" />
            </SelectTrigger>
            <SelectContent>
              {cargos.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
      {inicial && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
            className="size-4 mt-0.5 accent-[var(--primary)]"
          />
          <span>
            Ativo
            <span className="block text-2xs text-muted-foreground">
              Desativar bloqueia o login na hora e encerra as sessões abertas.
            </span>
          </span>
        </label>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {onCancelar && (
          <Button type="button" variant="ghost" onClick={onCancelar} disabled={salvando}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={salvando}>
          {salvando ? <Loader2 className="animate-spin" /> : null}
          {inicial ? "Salvar" : "Convidar"}
        </Button>
      </div>
    </form>
  );
}
