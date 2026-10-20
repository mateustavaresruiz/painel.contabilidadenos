import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ClienteSelect } from "@/components/features/clientes/cliente-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { msgErro } from "@/lib/erro";
import { isValidCpfCnpj, isValidTelefone, maskCpfCnpj, maskTelefone } from "@/lib/masks";
import { useClientesList } from "@/lib/queries/helpers";
import {
  TIPOS_CERTIFICADO,
  useSalvarCertificado,
  type Certificado,
  type TipoCertificado,
} from "@/lib/queries/certificados";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Criar/editar certificado digital. */
export function CertificadoDialog({
  open,
  onOpenChange,
  certificado,
  clienteIdFixo,
  renovarDe,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  certificado?: Certificado | null;
  /** Abre já com o cliente (detalhe do cliente / link do painel da conversa). */
  clienteIdFixo?: string | null;
  /**
   * Renovação: cadastro NOVO com os dados deste (sem as datas). Ao salvar, este
   * fica marcado como renovado e sai dos avisos e dos vencidos.
   */
  renovarDe?: Certificado | null;
}) {
  const salvar = useSalvarCertificado();
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoCertificado>("e-CNPJ A1");
  const [titular, setTitular] = useState("");
  const [documento, setDocumento] = useState("");
  const [emissora, setEmissora] = useState("");
  const [emitidoEm, setEmitidoEm] = useState("");
  const [validoAte, setValidoAte] = useState("");
  const [telefoneAviso, setTelefoneAviso] = useState("");
  const [avisar, setAvisar] = useState(true);
  const [obs, setObs] = useState("");
  const [tentou, setTentou] = useState(false);
  const [erroEmitido, setErroEmitido] = useState<string | null>(null);
  const [erroValido, setErroValido] = useState<string | null>(null);
  const tipoEscolhido = useRef(false);
  const clientes = useClientesList();

  useEffect(() => {
    if (!open) return;
    const c = certificado ?? renovarDe;
    setClienteId(c?.clienteId ?? clienteIdFixo ?? null);
    setTipo(c?.tipo ?? "e-CNPJ A1");
    setTitular(c?.titular ?? "");
    setDocumento(c?.documento ? maskCpfCnpj(c.documento) : "");
    setEmissora(c?.emissora ?? "");
    setEmitidoEm(renovarDe ? "" : (c?.emitidoEm ?? ""));
    setValidoAte(renovarDe ? "" : (c?.validoAte ?? ""));
    setTelefoneAviso(c?.telefoneAviso ? maskTelefone(c.telefoneAviso) : "");
    setAvisar(c?.avisarWhatsapp ?? true);
    setObs(c?.observacoes ?? "");
    setTentou(false);
    tipoEscolhido.current = !!c;
  }, [open, certificado, clienteIdFixo, renovarDe]);

  // Certificado novo: o tipo padrão acompanha o cliente (PF -> e-CPF A1, PJ -> e-CNPJ A1)
  // até a pessoa escolher o tipo na mão.
  const tipoDoCliente = clientes.data?.find((c) => c.id === clienteId)?.tipo;
  useEffect(() => {
    if (!open || certificado || renovarDe || tipoEscolhido.current || !tipoDoCliente) return;
    setTipo(tipoDoCliente === "PF" ? "e-CPF A1" : "e-CNPJ A1");
  }, [open, certificado, renovarDe, tipoDoCliente]);

  const erros = {
    cliente: clienteId ? null : "Escolha o cliente.",
    validoAte: erroValido ?? (validoAte ? null : "Informe a validade."),
    emitidoEm: erroEmitido ?? (emitidoEm && validoAte && emitidoEm > validoAte ? "A emissão é depois da validade." : null),
    documento: documento && !isValidCpfCnpj(documento) ? "CPF ou CNPJ inválido." : null,
    telefoneAviso: telefoneAviso && !isValidTelefone(telefoneAviso) ? "Telefone incompleto (DDD + número)." : null,
  };
  const temErro = Object.values(erros).some(Boolean);
  const ver = (k: keyof typeof erros) => (tentou ? erros[k] : null);
  const inv = (k: keyof typeof erros) => (ver(k) ? "border-destructive" : undefined);
  const msg = (k: keyof typeof erros) =>
    ver(k) ? (
      <p role="alert" className="text-xs text-destructive">
        {ver(k)}
      </p>
    ) : null;

  async function enviar() {
    setTentou(true);
    if (temErro || !clienteId) return;
    try {
      await salvar.mutateAsync({
        id: certificado?.id,
        renovarDe: certificado ? undefined : renovarDe?.id,
        input: {
          clienteId,
          tipo,
          titular,
          documento,
          emissora,
          emitidoEm: emitidoEm || null,
          validoAte,
          telefoneAviso,
          avisarWhatsapp: avisar,
          observacoes: obs,
        },
      });
      if (renovarDe && !certificado) toast.success("Certificado renovado");
      onOpenChange(false);
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {certificado ? "Editar certificado" : renovarDe ? "Renovar certificado" : "Novo certificado digital"}
          </DialogTitle>
          <DialogDescription>
            O aviso automático pelo WhatsApp usa os marcos e o modelo configurados na tela de
            Certificados.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-h-[65vh] overflow-y-auto px-0.5">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Cliente *</Label>
            <ClienteSelect value={clienteId} onChange={setClienteId} disabled={!!clienteIdFixo && !certificado} />
            {msg("cliente")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cd-tipo">Tipo</Label>
            <Select
              value={tipo}
              onValueChange={(v) => {
                tipoEscolhido.current = true;
                setTipo(v as TipoCertificado);
              }}
            >
              <SelectTrigger id="cd-tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_CERTIFICADO.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cd-emissora">Emissora (AC)</Label>
            <Input id="cd-emissora" value={emissora} onChange={(e) => setEmissora(e.target.value)} placeholder="Serasa, Certisign, Valid…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cd-titular">Titular</Label>
            <Input id="cd-titular" value={titular} onChange={(e) => setTitular(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cd-doc">CPF/CNPJ do titular</Label>
            <Input
              id="cd-doc"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={documento}
              onChange={(e) => setDocumento(maskCpfCnpj(e.target.value))}
              aria-invalid={!!ver("documento") || undefined}
              className={inv("documento")}
            />
            {msg("documento")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cd-emitido">Emitido em</Label>
            <DatePicker id="cd-emitido" limpavel value={emitidoEm} onChange={setEmitidoEm} onErroChange={setErroEmitido} />
            {tentou && !erroEmitido ? msg("emitidoEm") : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cd-valido">Válido até *</Label>
            <DatePicker id="cd-valido" value={validoAte} onChange={setValidoAte} onErroChange={setErroValido} />
            {tentou && !erroValido ? msg("validoAte") : null}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cd-tel">Telefone para o aviso</Label>
            <Input
              id="cd-tel"
              inputMode="tel"
              value={telefoneAviso}
              onChange={(e) => setTelefoneAviso(maskTelefone(e.target.value))}
              placeholder="Vazio = telefone do cliente"
              aria-invalid={!!ver("telefoneAviso") || undefined}
              className={cn(inv("telefoneAviso"))}
            />
            {msg("telefoneAviso")}
          </div>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={avisar}
              onChange={(e) => setAvisar(e.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            Avisar o cliente pelo WhatsApp antes de vencer
          </label>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cd-obs">Observações</Label>
            <Textarea id="cd-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
