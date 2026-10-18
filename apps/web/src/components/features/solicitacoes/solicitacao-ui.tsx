import { ChevronDown, ClipboardPlus, Info, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ColaboradorSelect } from "@/components/colaborador-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { QueryError } from "@/components/ui/query-error";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEu } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { useModulos } from "@/lib/modulos";
import { garantirClienteDaConversa } from "@/lib/queries/clientes";
import {
  STATUS_SOLICITACAO,
  STATUS_SOLICITACAO_LABEL,
  useCriarSolicitacao,
  useSolicitacaoTipos,
  type SolicitacaoStatus,
} from "@/lib/queries/solicitacoes";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Origem do chamado: a conversa (e opcionalmente a mensagem) e o cliente. */
export type OrigemSolicitacao = {
  chatRowId?: string | null;
  /** Conversa de grupo: não ganha cadastro provisório. */
  grupo?: boolean;
  clienteId?: string | null;
  mensagemId?: string | null;
  descricao?: string | null;
};

const TOM_STATUS: Record<SolicitacaoStatus, string> = {
  aberta: "bg-primary/10 text-primary border-primary/20",
  em_andamento: "bg-warning/10 text-warning border-warning/25",
  concluida: "bg-success/10 text-success border-success/25",
  cancelada: "bg-muted text-muted-foreground border-border",
};

export function StatusSolicitacaoBadge({
  status,
  className,
}: {
  status: SolicitacaoStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium",
        TOM_STATUS[status],
        className,
      )}
    >
      {STATUS_SOLICITACAO_LABEL[status]}
    </span>
  );
}

/** Troca de status inline (select compacto pintado pelo status). */
export function StatusSolicitacaoSelect({
  value,
  onChange,
  disabled,
}: {
  value: SolicitacaoStatus;
  onChange: (s: SolicitacaoStatus) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SolicitacaoStatus)} disabled={disabled}>
      <SelectTrigger
        className="h-8 w-[150px] rounded-full px-2"
        aria-label="Status do chamado"
      >
        <SelectValue>
          <StatusSolicitacaoBadge status={value} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {STATUS_SOLICITACAO.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Botão "Abrir chamado" do topo da conversa: abre a lista de tipos ativos;
 * escolher um abre o diálogo curto (descrição, responsável, prazo).
 */
/** O botão some quando Configurações desliga Chamados ou "abrir chamado na conversa". */
export function SolicitacaoBotaoSeAtivo({ origem }: { origem: OrigemSolicitacao }) {
  const { ativo } = useModulos();
  const { tem } = useEu();
  if (!ativo("chamadoNaConversa") || !tem("chamados.criar")) return null;
  return <SolicitacaoBotao origem={origem} />;
}

export function SolicitacaoBotao({ origem }: { origem: OrigemSolicitacao }) {
  const { data: tipos = [], isLoading } = useSolicitacaoTipos({ somenteAtivos: true });
  const [menu, setMenu] = useState(false);
  const [tipoId, setTipoId] = useState<string | null>(null);

  return (
    <>
      <Popover open={menu} onOpenChange={setMenu}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="secondary" className="h-8 gap-1.5 border border-border/70">
            <ClipboardPlus />
            <span className="hidden md:inline">Abrir chamado</span>
            <ChevronDown className="!size-3 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-1">
          <p className="eyebrow px-2 pt-1.5 pb-1">Novo chamado</p>
          {isLoading ? (
            <div className="py-4 grid place-items-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : tipos.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              Nenhum tipo ativo. Cadastre em Chamados → Tipos de chamado.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {tipos.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    setTipoId(t.id);
                  }}
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  {t.nome}
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
      <NovaSolicitacaoDialog
        open={!!tipoId}
        onOpenChange={(o) => !o && setTipoId(null)}
        tipoIdInicial={tipoId}
        origem={origem}
      />
    </>
  );
}

/** O módulo "chamado na conversa" está ligado e o cargo pode abrir chamado. */
export function usePodeAbrirChamadoNaConversa(): boolean {
  const { ativo } = useModulos();
  const { tem } = useEu();
  return ativo("chamadoNaConversa") && tem("chamados.criar");
}

/**
 * "Abrir chamado" como item de menu (folha de ações da conversa no celular):
 * toca e os tipos abrem logo abaixo, com alvos de 44 px. Quem chama guarda o
 * diálogo (`NovaSolicitacaoDialog`), porque a folha fecha ao escolher.
 */
export function SolicitacaoTiposItem({ onEscolher }: { onEscolher: (tipoId: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const { data: tipos = [], isLoading } = useSolicitacaoTipos({ somenteAtivos: true });
  return (
    <div>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
      >
        <ClipboardPlus className="size-4 text-muted-foreground" />
        <span className="flex-1">Abrir chamado</span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", aberto && "rotate-180")} />
      </button>
      {aberto && (
        <div className="ml-8 border-l border-border/70 pl-1">
          {isLoading ? (
            <div className="grid place-items-center py-3">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : tipos.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              Nenhum tipo ativo. Cadastre em Chamados → Tipos de chamado.
            </p>
          ) : (
            tipos.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onEscolher(t.id)}
                className="flex min-h-11 w-full items-center rounded-md px-2.5 text-left text-sm hover:bg-accent"
              >
                {t.nome}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Diálogo curto de novo chamado (tipo pode vir escolhido). */
export function NovaSolicitacaoDialog({
  open,
  onOpenChange,
  tipoIdInicial,
  origem,
  onCriada,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tipoIdInicial?: string | null;
  origem: OrigemSolicitacao;
  onCriada?: (id: string) => void;
}) {
  const { eu } = useEu();
  const tiposQ = useSolicitacaoTipos({ somenteAtivos: true });
  const tipos = tiposQ.data ?? [];
  const [erroTipo, setErroTipo] = useState(false);
  const criar = useCriarSolicitacao();
  const qc = useQueryClient();
  const [garantindo, setGarantindo] = useState(false);
  const salvando = garantindo || criar.isPending;
  // Chamado aberto da conversa sem cliente: o banco vincula pelo telefone ou
  // cria um cadastro provisório com o nome e o número do WhatsApp.
  const semCliente = !!origem.chatRowId && !origem.clienteId && !origem.grupo;
  const [tipoId, setTipoId] = useState<string>("");
  const [descricao, setDescricao] = useState("");
  const [responsavel, setResponsavel] = useState<string | null>(null);
  const [prazo, setPrazo] = useState("");

  // Reinicia a cada abertura com o que veio de fora (tipo e texto da mensagem).
  useEffect(() => {
    if (!open) return;
    setTipoId(tipoIdInicial ?? "");
    setDescricao(origem.descricao ?? "");
    setResponsavel(eu?.id ?? null);
    setPrazo("");
    setErroTipo(false);
  }, [open, tipoIdInicial, origem.descricao, eu?.id]);

  async function salvar() {
    if (!tipoId) {
      setErroTipo(true);
      return;
    }
    let clienteId = origem.clienteId ?? null;
    let provisorio: { nome: string } | null = null;
    if (origem.chatRowId && !clienteId) {
      setGarantindo(true);
      try {
        const c = await garantirClienteDaConversa(origem.chatRowId);
        clienteId = c?.id ?? null;
        if (c?.provisorio) provisorio = { nome: c.nome };
        qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
        qc.invalidateQueries({ queryKey: ["whatsapp-chat"] });
        qc.invalidateQueries({ queryKey: ["clientes"] });
        qc.invalidateQueries({ queryKey: ["conversas-do-cliente"] });
      } catch (err) {
        toast.error("Não foi possível preparar o cadastro do contato: " + msgErro(err));
        return;
      } finally {
        setGarantindo(false);
      }
    }
    try {
      const r = await criar.mutateAsync({
        tipoId,
        descricao,
        responsavelId: responsavel,
        prazo: prazo || null,
        clienteId,
        chatId: origem.chatRowId ?? null,
        mensagemId: origem.mensagemId ?? null,
        criadoPorId: eu?.id ?? null,
      });
      toast.info(
        provisorio
          ? `Chamado aberto. Criamos um cadastro provisório para ${provisorio.nome}; complete depois em Clientes.`
          : "Chamado aberto.",
      );
      onCriada?.(r.id);
      onOpenChange(false);
    } catch (err) {
      toast.error("Não foi possível registrar: " + msgErro(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Abrir chamado</DialogTitle>
          <DialogDescription>
            {origem.mensagemId
              ? "A partir desta mensagem. Fica ligado à conversa e ao cliente."
              : origem.chatRowId
                ? "Fica ligado a esta conversa e ao cliente vinculado."
                : "Registre o pedido do cliente."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {semCliente && (
            <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden />
              Vamos criar um cadastro provisório com o nome e o número do WhatsApp.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="sol-tipo">Tipo</Label>
            {tiposQ.isError && tipos.length === 0 ? (
              <QueryError compacto oque="os tipos" error={tiposQ.error} onRetry={tiposQ.refetch} />
            ) : (
            <Select value={tipoId} onValueChange={(v) => { setTipoId(v); setErroTipo(false); }}>
              <SelectTrigger id="sol-tipo" aria-invalid={erroTipo || undefined} className={cn(erroTipo && "border-destructive")}>
                <SelectValue placeholder="Escolha o tipo" />
              </SelectTrigger>
              <SelectContent>
                {tipos.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            )}
            {erroTipo && <p role="alert" className="text-xs text-destructive">Escolha o tipo do chamado.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sol-desc">Descrição</Label>
            <Textarea
              id="sol-desc"
              rows={4}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="O que o cliente pediu?"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sol-resp">Responsável</Label>
              <ColaboradorSelect
                id="sol-resp"
                value={responsavel}
                onChange={setResponsavel}
                rotuloNenhum="Ninguém ainda"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sol-prazo">Prazo</Label>
              <DatePicker id="sol-prazo" limpavel value={prazo} onChange={setPrazo} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? <Loader2 className="animate-spin" /> : <ClipboardPlus />}
            Abrir chamado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
