import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CalendarDays, ClipboardList, Loader2, MessageSquare, Send, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { CadastroIncompletoBadge } from "@/components/features/clientes/cadastro-incompleto-badge";
import { HistoricoLista } from "@/components/features/auditoria/linha-do-tempo";
import { StatusSolicitacaoSelect } from "@/components/features/solicitacoes/solicitacao-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useColaboradoresMap, usePermissao } from "@/lib/colaborador";
import { corModulo } from "@/lib/cores-modulo";
import { msgErro } from "@/lib/erro";
import { formatData, formatDataHora, formatTelefone, hojeISO } from "@/lib/format";
import { useComentarChamado } from "@/lib/queries/auditoria";
import { contatoDoChamado, useAtualizarSolicitacao, useSolicitacao } from "@/lib/queries/solicitacoes";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const MAX_COMENTARIO = 2000;

/**
 * Gaveta do chamado: dados, mudança de status na hora, caixa de comentário e a
 * linha do tempo completa (quem fez o quê, com o antes e o depois). A linha do
 * tempo vem da auditoria do banco (migration 009), então vale para qualquer
 * jeito de mexer no chamado.
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
  const atualizar = useAtualizarSolicitacao();
  const podeCriar = usePermissao("chamados.criar");

  const resp = s?.responsavelId ? mapa.get(s.responsavelId) : undefined;
  const criador = s?.criadoPorId ? mapa.get(s.criadoPorId) : undefined;
  const contato = s ? contatoDoChamado(s) : null;
  const tel = contato?.telefone ? formatTelefone(contato.telefone) : null;
  const atrasada =
    !!s?.prazo && s.prazo < hojeISO() && (s.status === "aberta" || s.status === "em_andamento");

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
                <StatusSolicitacaoSelect
                  value={s.status}
                  disabled={atualizar.isPending}
                  onChange={(status) =>
                    atualizar.mutate({ id: s.id, patch: { status } }, { onError: (e) => toast.error(msgErro(e)) })
                  }
                />
              </Campo>
              <Campo rotulo="Prazo">
                <span className={cn("inline-flex items-center gap-1.5", atrasada && "font-medium text-destructive")}>
                  <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
                  {s.prazo ? formatData(s.prazo) : "Sem prazo"}
                  {atrasada && <Badge variant="destructive">atrasada</Badge>}
                </span>
              </Campo>
              <Campo rotulo="Cliente">
                {contato?.nome || tel ? (
                  <div className="flex min-w-0 flex-col items-start gap-0.5 leading-tight">
                    {s.cliente ? (
                      <Link to={`/clientes/${s.cliente.id}`} className="font-medium text-primary hover:underline">
                        {contato?.nome}
                      </Link>
                    ) : (
                      <span className="font-medium">{contato?.nome ?? tel}</span>
                    )}
                    {tel && tel !== contato?.nome && <span className="text-xs tabular-nums text-muted-foreground">{tel}</span>}
                    {contato?.provisorio && <CadastroIncompletoBadge className="mt-0.5" />}
                  </div>
                ) : (
                  <span className="text-muted-foreground">Sem cliente</span>
                )}
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
              {s.descricao && (
                <Campo rotulo="Descrição" className="sm:col-span-2">
                  <p className="whitespace-pre-wrap break-words">{s.descricao}</p>
                </Campo>
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

function Campo({ rotulo, children, className }: { rotulo: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <dt className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
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
