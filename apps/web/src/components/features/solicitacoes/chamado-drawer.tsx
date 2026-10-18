import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CalendarDays, ClipboardList, Loader2, MessageSquare, Save, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { ColaboradorSelect } from "@/components/colaborador-select";
import { CadastroIncompletoBadge } from "@/components/features/clientes/cadastro-incompleto-badge";
import { ClienteSelect } from "@/components/features/clientes/cliente-select";
import { HistoricoLista } from "@/components/features/auditoria/linha-do-tempo";
import { StatusSolicitacaoSelect, useTrocarStatusChamado } from "@/components/features/solicitacoes/solicitacao-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useColaboradoresMap, usePermissao } from "@/lib/colaborador";
import { corModulo } from "@/lib/cores-modulo";
import { msgErro } from "@/lib/erro";
import { formatData, formatDataHora, formatTelefone, hojeISO } from "@/lib/format";
import { useComentarChamado } from "@/lib/queries/auditoria";
import { useClientesList } from "@/lib/queries/helpers";
import {
  chamadoAtrasado,
  contatoDoChamado,
  useAtualizarSolicitacao,
  useSolicitacao,
  useSolicitacaoTipos,
  type Solicitacao,
} from "@/lib/queries/solicitacoes";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const MAX_COMENTARIO = 2000;

/**
 * Gaveta do chamado: dados, mudança de status na hora, caixa de comentário e a
 * linha do tempo completa (quem fez o quê, com o antes e o depois). A linha do
 * tempo vem da auditoria do banco (migration 009), então vale para qualquer
 * jeito de mexer no chamado.
 *
 * Quem tem `chamados.gerenciar` edita responsável, prazo, cliente, tipo e
 * descrição aqui mesmo (o banco só deixa essa pessoa mudar esses campos; o
 * responsável sem a permissão muda só o status).
 */
export function ChamadoDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full max-w-full bg-background sm:max-w-xl"
        aria-describedby={undefined}
      >
        {id && <Conteudo id={id} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function Conteudo({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: s, isLoading } = useSolicitacao(id);
  const mapa = useColaboradoresMap();
  const { trocar, pendente } = useTrocarStatusChamado();
  const podeCriar = usePermissao("chamados.criar");
  const podeGerenciar = usePermissao("chamados.gerenciar");

  const criador = s?.criadoPorId ? mapa.get(s.criadoPorId) : undefined;
  const atrasada = !!s && chamadoAtrasado(s, hojeISO());

  return (
    <>
      <SheetHeader className="flex-row items-start gap-3 pt-4">
        <span className="chip-mod grid size-10 shrink-0 place-items-center rounded-xl" style={corModulo("chamados")}>
          <ClipboardList className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="truncate text-base font-semibold leading-tight">
            {isLoading ? "Chamado" : s?.tipo?.nome ?? "Chamado"}
          </DialogPrimitive.Title>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {s ? `Aberto em ${formatDataHora(s.criadoEm)}${criador ? ` por ${criador.nome.split(" ")[0]}` : s.origem === "portal" ? " pelo portal do cliente" : ""}` : "Carregando…"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-sm:size-11"
          aria-label="Fechar"
        >
          <X className="size-5" />
        </button>
      </SheetHeader>

      <SheetBody className="space-y-6 px-4 py-4">
        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !s ? (
          <p className="text-sm text-muted-foreground">Este chamado não existe mais ou você não tem acesso a ele.</p>
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
              <Campo rotulo="Status">
                <StatusSolicitacaoSelect value={s.status} disabled={pendente} onChange={(status) => trocar(s.id, s.status, status)} />
              </Campo>
              {podeGerenciar ? (
                <CamposEditaveis s={s} atrasada={atrasada} />
              ) : (
                <CamposLeitura s={s} atrasada={atrasada} />
              )}
              {s.chat && (
                <Campo rotulo="Origem" className="sm:col-span-2">
                  <Button asChild size="sm" variant="outline">
                    <Link
                      to={`/whatsapp?instancia=${encodeURIComponent(s.chat.sessaoId)}&chat=${encodeURIComponent(s.chat.chatId)}`}
                    >
                      <MessageSquare />
                      Abrir a conversa{s.chat.nome ? ` com ${s.chat.nome}` : ""}
                    </Link>
                  </Button>
                </Campo>
              )}
              {podeGerenciar ? (
                <DescricaoEditavel s={s} />
              ) : (
                s.descricao && (
                  <Campo rotulo="Descrição" className="sm:col-span-2">
                    <p className="whitespace-pre-wrap break-words">{s.descricao}</p>
                  </Campo>
                )
              )}
            </dl>

            {podeCriar && <CaixaComentario id={s.id} />}

            <section aria-label="Histórico do chamado">
              <h3 className="mb-1 text-sm font-semibold">Histórico</h3>
              <HistoricoLista
                entidade="chamado"
                id={s.id}
                vazio="O histórico deste chamado começa aqui. Mudanças de status, responsável, prazo e comentários aparecem em ordem."
              />
            </section>
          </>
        )}
      </SheetBody>
    </>
  );
}

/** Prazo, cliente e responsável só para ler (quem não gerencia chamados). */
function CamposLeitura({ s, atrasada }: { s: Solicitacao; atrasada: boolean }) {
  const mapa = useColaboradoresMap();
  const resp = s.responsavelId ? mapa.get(s.responsavelId) : undefined;
  return (
    <>
      <Campo rotulo="Prazo">
        <span className={cn("inline-flex items-center gap-1.5", atrasada && "font-medium text-destructive")}>
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
          {s.prazo ? formatData(s.prazo) : "Sem prazo"}
          {atrasada && <Badge variant="destructive">atrasado</Badge>}
        </span>
      </Campo>
      <Campo rotulo="Cliente">
        <ClienteLeitura s={s} />
      </Campo>
      <Campo rotulo="Responsável">
        {resp ? (
          <span className="inline-flex items-center gap-2">
            <ColaboradorAvatar nome={resp.nome} cor={resp.cor} size="xs" />
            {resp.nome}
          </span>
        ) : (
          <span className="text-muted-foreground">Sem responsável</span>
        )}
      </Campo>
    </>
  );
}

function ClienteLeitura({ s }: { s: Solicitacao }) {
  const contato = contatoDoChamado(s);
  const tel = contato.telefone ? formatTelefone(contato.telefone) : null;
  if (!contato.nome && !tel) return <span className="text-muted-foreground">Sem cliente</span>;
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5 leading-tight">
      {s.cliente ? (
        <Link to={`/clientes/${s.cliente.id}`} className="font-medium text-primary hover:underline">
          {contato.nome}
        </Link>
      ) : (
        <span className="font-medium">{contato.nome ?? tel}</span>
      )}
      {tel && tel !== contato.nome && <span className="text-xs tabular-nums text-muted-foreground">{tel}</span>}
      {contato.provisorio && <CadastroIncompletoBadge className="mt-0.5" />}
    </div>
  );
}

/** Tipo, prazo, cliente e responsável editáveis (chamados.gerenciar). Cada troca grava na hora. */
function CamposEditaveis({ s, atrasada }: { s: Solicitacao; atrasada: boolean }) {
  const atualizar = useAtualizarSolicitacao();
  const { data: tipos = [] } = useSolicitacaoTipos();
  const { data: clientes = [] } = useClientesList();
  const gravar = (
    patch: Parameters<typeof atualizar.mutate>[0]["patch"],
    exibir?: Parameters<typeof atualizar.mutate>[0]["exibir"],
  ) => atualizar.mutate({ id: s.id, patch, exibir }, { onError: (e) => toast.error(msgErro(e)) });
  // Tipo inativo que o chamado já usa continua na lista (senão o select fica vazio).
  const opcoesTipo = tipos.filter((t) => t.ativo || t.id === s.tipoId);

  return (
    <>
      <Campo rotulo="Prazo" htmlFor="ch-prazo">
        <div className="space-y-1">
          <PrazoEditavel prazo={s.prazo} onSalvar={(p) => gravar({ prazo: p })} />
          {atrasada && <Badge variant="destructive">atrasado</Badge>}
        </div>
      </Campo>
      <Campo rotulo="Tipo" htmlFor="ch-tipo">
        <Select
          value={s.tipoId}
          onValueChange={(v) => {
            if (v === s.tipoId) return;
            const t = tipos.find((x) => x.id === v);
            gravar({ tipoId: v }, t ? { tipo: { id: t.id, nome: t.nome } } : undefined);
          }}
        >
          <SelectTrigger id="ch-tipo">
            <SelectValue placeholder="Tipo do chamado" />
          </SelectTrigger>
          <SelectContent>
            {opcoesTipo.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nome}
                {!t.ativo ? " (inativo)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>
      <Campo rotulo="Cliente" htmlFor="ch-cliente">
        <div className="space-y-1">
          <ClienteSelect
            id="ch-cliente"
            value={s.clienteId}
            limpavel
            placeholder="Sem cliente"
            onChange={(v) => {
              if (v === s.clienteId) return;
              const c = v ? clientes.find((x) => x.id === v) : null;
              gravar(
                { clienteId: v },
                { cliente: c ? { id: c.id, nome: c.nome, nomeFantasia: c.nomeFantasia, telefone: c.telefone, provisorio: false } : null },
              );
            }}
          />
          {s.cliente && (
            <Link to={`/clientes/${s.cliente.id}`} className="text-2xs font-semibold text-primary hover:underline">
              Abrir a ficha
            </Link>
          )}
          {s.cliente?.provisorio && <CadastroIncompletoBadge />}
        </div>
      </Campo>
      <Campo rotulo="Responsável" htmlFor="ch-resp">
        <ColaboradorSelect
          id="ch-resp"
          value={s.responsavelId}
          rotuloNenhum="Sem responsável"
          onChange={(v) => {
            if (v !== s.responsavelId) gravar({ responsavelId: v });
          }}
        />
      </Campo>
    </>
  );
}

/**
 * Prazo que grava sozinho. O DatePicker emite "" também no meio da digitação
 * ("12/1"), então espera um instante e só limpa o prazo se o campo estiver
 * vazio de verdade; data completa grava assim que fica válida.
 */
function PrazoEditavel({ prazo, onSalvar }: { prazo: string | null; onSalvar: (p: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState(prazo ?? "");
  useEffect(() => setLocal(prazo ?? ""), [prazo]);
  useEffect(() => {
    if ((local || null) === prazo) return;
    const t = setTimeout(() => {
      if (local) onSalvar(local);
      else if ((ref.current?.value ?? "").trim() === "") onSalvar(null);
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, prazo]);
  return <DatePicker ref={ref} id="ch-prazo" limpavel value={local} onChange={setLocal} placeholder="Sem prazo" />;
}

/** Descrição com botão Salvar (só aparece quando o texto mudou). */
function DescricaoEditavel({ s }: { s: Solicitacao }) {
  const atualizar = useAtualizarSolicitacao();
  const [texto, setTexto] = useState(s.descricao ?? "");
  // Chegou versão nova do servidor (outra pessoa ou o próprio salvar): acompanha.
  useEffect(() => setTexto(s.descricao ?? ""), [s.descricao]);
  const mudou = texto.trim() !== (s.descricao ?? "").trim();

  function salvar() {
    atualizar.mutate(
      { id: s.id, patch: { descricao: texto.trim() || null } },
      { onError: (e) => toast.error(msgErro(e)), onSuccess: () => toast.success("Descrição salva") },
    );
  }

  return (
    <Campo rotulo="Descrição" htmlFor="ch-desc" className="sm:col-span-2">
      <div className="space-y-2">
        <Textarea
          id="ch-desc"
          rows={3}
          value={texto}
          onChange={(e) => setTexto(e.target.value.slice(0, 4000))}
          placeholder="O que o cliente pediu?"
          className="text-base fino:text-sm"
        />
        {mudou && (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setTexto(s.descricao ?? "")}>
              Cancelar
            </Button>
            <Button size="sm" onClick={salvar} disabled={atualizar.isPending}>
              {atualizar.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              Salvar
            </Button>
          </div>
        )}
      </div>
    </Campo>
  );
}

function Campo({
  rotulo,
  children,
  className,
  htmlFor,
}: {
  rotulo: string;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <dt className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {htmlFor ? <label htmlFor={htmlFor}>{rotulo}</label> : rotulo}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function CaixaComentario({ id }: { id: string }) {
  const [texto, setTexto] = useState("");
  const comentar = useComentarChamado();
  const limpo = texto.trim();

  function enviar() {
    if (!limpo || comentar.isPending) return;
    comentar.mutate(
      { id, texto: limpo },
      {
        onSuccess: () => setTexto(""),
        onError: (e) => toast.error(msgErro(e)),
      },
    );
  }

  return (
    <section aria-label="Comentar" className="space-y-2">
      <h3 className="text-sm font-semibold">Comentar</h3>
      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value.slice(0, MAX_COMENTARIO))}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            enviar();
          }
        }}
        placeholder="Anote o que foi feito ou combinado. Fica registrado no histórico com seu nome."
        rows={3}
        aria-label="Comentário"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-2xs text-muted-foreground"><span className="toque:hidden">Ctrl + Enter envia · </span>{texto.length}/{MAX_COMENTARIO}</span>
        <Button size="sm" onClick={enviar} disabled={!limpo || comentar.isPending}>
          {comentar.isPending ? <Loader2 className="animate-spin" /> : <Send />}
          Comentar
        </Button>
      </div>
    </section>
  );
}
