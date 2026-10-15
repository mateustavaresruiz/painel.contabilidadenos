import {
  ArrowRightLeft,
  BadgeCheck,
  Building2,
  ClipboardList,
  ExternalLink,
  Link2,
  Link2Off,
  Loader2,
  Plus,
  User,
  Users,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { ColaboradorAvatar, SemResponsavelAvatar } from "@/components/colaborador-avatar";
import { CertificadoStatusBadge } from "@/components/features/certificados/certificado-status";
import { VincularClienteDialog } from "@/components/features/inbox/vincular-cliente-dialog";
import {
  NovaSolicitacaoDialog,
  StatusSolicitacaoSelect,
} from "@/components/features/solicitacoes/solicitacao-ui";
import { Button } from "@/components/ui/button";
import { confirmar } from "@/components/ui/confirm-dialog";
import { useColaboradoresMap, usePermissao } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { useModulos } from "@/lib/modulos";
import { formatData, formatDataHora, formatDoc, formatTelefone } from "@/lib/format";
import {
  ATENDIMENTO_LABEL,
  useTransferencias,
} from "@/lib/queries/atendimento";
import { useCertificados } from "@/lib/queries/certificados";
import {
  nomeExibicao,
  useCliente,
  useClientesPorTelefone,
  useSocios,
} from "@/lib/queries/clientes";
import { useAtualizarSolicitacao, useSolicitacoes } from "@/lib/queries/solicitacoes";
import { useVincularChatCliente, type WhatsappChat } from "@/lib/queries/whatsapp";
import { toast } from "@/lib/toast";

import { textoTransferencia } from "./atendimento-acoes";

/**
 * Painel lateral da conversa — versão leve do `client-context-panel` do adv3
 * (lá era jurídico: processos, honorários, documentos). Aqui: cliente
 * vinculado, sócios, certificado, chamados abertos e o histórico de
 * transferências do atendimento.
 */
export function PainelConversa({
  chat,
  nomeContato,
  onClose,
}: {
  chat: WhatsappChat;
  nomeContato: string;
  onClose: () => void;
}) {
  const ehLid = chat.chatId.endsWith("@lid");
  // @lid não tem telefone: os dígitos são um identificador interno do
  // WhatsApp, e criar cliente com eles gravava lixo (defeito 45 do adv3).
  const telefone = ehLid ? null : chat.chatId.replace(/@.*/, "");
  const { data: cliente, isLoading: carregandoCliente } = useCliente(chat.clienteId);
  const sugestoes = useClientesPorTelefone(!chat.clienteId && telefone ? telefone : undefined);
  const vincular = useVincularChatCliente();
  const [vincularAberto, setVincularAberto] = useState(false);
  const [novaSolicitacao, setNovaSolicitacao] = useState(false);
  const podeCriarChamado = usePermissao("chamados.criar");
  const chamadoNaConversa = useModulos().ativo("chamadoNaConversa") && podeCriarChamado;

  async function vincularA(clienteId: string | null) {
    try {
      await vincular.mutateAsync({ chatRowId: chat.id, clienteId });
      setVincularAberto(false);
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  return (
    <div className="flex h-full w-full md:w-[360px] flex-col bg-card border-l">
      <div className="flex items-center gap-2 border-b px-4 py-3 shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{nomeContato}</p>
          <p className="text-2xs text-muted-foreground truncate">
            {telefone ? formatTelefone(telefone) : "Contato sem número visível"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid place-items-center size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Fechar painel"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y">
        {/* Cliente */}
        <Secao titulo="Cliente" icone={chat.clienteId && cliente?.tipo === "PJ" ? Building2 : User}>
          {chat.clienteId ? (
            carregandoCliente ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : cliente ? (
              <div className="space-y-2">
                <div>
                  <Link
                    to={`/clientes/${cliente.id}`}
                    className="text-sm font-medium hover:underline inline-flex items-center gap-1"
                  >
                    {nomeExibicao(cliente)}
                    <ExternalLink className="size-3 opacity-60" />
                  </Link>
                  {cliente.nomeFantasia && cliente.nomeFantasia !== cliente.nome && (
                    <p className="text-2xs text-muted-foreground">{cliente.nome}</p>
                  )}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">{cliente.tipo === "PJ" ? "CNPJ" : "CPF"}</dt>
                  <dd className="truncate">{formatDoc(cliente.cpfCnpj)}</dd>
                  {cliente.regimeTributario && (
                    <>
                      <dt className="text-muted-foreground">Regime</dt>
                      <dd>{cliente.regimeTributario}</dd>
                    </>
                  )}
                  {cliente.telefone && (
                    <>
                      <dt className="text-muted-foreground">Telefone</dt>
                      <dd>{formatTelefone(cliente.telefone)}</dd>
                    </>
                  )}
                  {cliente.email && (
                    <>
                      <dt className="text-muted-foreground">E-mail</dt>
                      <dd className="truncate">{cliente.email}</dd>
                    </>
                  )}
                </dl>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Button size="sm" variant="outline" className="h-7" onClick={() => setVincularAberto(true)}>
                    <Link2 />
                    Trocar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-muted-foreground"
                    disabled={vincular.isPending}
                    onClick={async () => {
                      if (
                        await confirmar({
                          titulo: "Desvincular cliente?",
                          descricao: "A conversa continua; só deixa de estar ligada a este cadastro.",
                          confirmLabel: "Desvincular",
                        })
                      )
                        void vincularA(null);
                    }}
                  >
                    <Link2Off />
                    Desvincular
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Cliente vinculado não encontrado.</p>
            )
          ) : (
            <div className="space-y-2.5">
              {sugestoes.data && sugestoes.data.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-2xs text-muted-foreground">Cadastro com este telefone:</p>
                  {sugestoes.data.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
                      <span className="flex-1 min-w-0 text-sm truncate">{nomeExibicao(c)}</span>
                      <Button
                        size="sm"
                        className="h-7"
                        disabled={vincular.isPending}
                        onClick={() => void vincularA(c.id)}
                      >
                        Vincular
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Conversa sem cliente vinculado.</p>
              <Button size="sm" variant="outline" onClick={() => setVincularAberto(true)}>
                <Link2 />
                Vincular ou cadastrar
              </Button>
            </div>
          )}
        </Secao>

        {cliente?.tipo === "PJ" && <SociosSecao clienteId={cliente.id} />}
        {cliente && <CertificadosSecao clienteId={cliente.id} />}

        {chamadoNaConversa && (
          <SolicitacoesSecao chatRowId={chat.id} onNova={() => setNovaSolicitacao(true)} />
        )}

        <AtendimentoSecao chat={chat} />
      </div>

      <VincularClienteDialog
        open={vincularAberto}
        onOpenChange={setVincularAberto}
        canal="whatsapp"
        conversaId={chat.chatId}
        sugestao={telefone}
        nomeSugerido={chat.nome}
        onConfirmar={(id) => vincularA(id)}
      />
      <NovaSolicitacaoDialog
        open={novaSolicitacao}
        onOpenChange={setNovaSolicitacao}
        origem={{ chatRowId: chat.id, clienteId: chat.clienteId }}
      />
    </div>
  );
}

function Secao({
  titulo,
  icone: Icon,
  acao,
  children,
}: {
  titulo: string;
  icone: React.ComponentType<{ className?: string }>;
  acao?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="px-4 py-3.5 space-y-2.5">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 text-bronze" />
        <h3 className="eyebrow flex-1">{titulo}</h3>
        {acao}
      </div>
      {children}
    </section>
  );
}

function SociosSecao({ clienteId }: { clienteId: string }) {
  const { data: socios = [], isLoading } = useSocios(clienteId);
  return (
    <Secao titulo="Sócios" icone={Users}>
      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : socios.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum sócio cadastrado.{" "}
          <Link to={`/clientes/${clienteId}?aba=socios`} className="underline">
            Cadastrar
          </Link>
        </p>
      ) : (
        <ul className="space-y-1.5">
          {socios.map((s) => (
            <li key={s.id} className="text-xs">
              <span className="font-medium">{s.nome}</span>
              {s.administrador && <span className="text-muted-foreground"> · administrador</span>}
              {s.participacao != null && <span className="text-muted-foreground"> · {s.participacao}%</span>}
              {s.dataNascimento && (
                <span className="block text-2xs text-muted-foreground">
                  Nasc. {formatData(s.dataNascimento)}
                  {s.telefone ? ` · ${formatTelefone(s.telefone)}` : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

function CertificadosSecao({ clienteId }: { clienteId: string }) {
  const { data: certs = [], isLoading } = useCertificados({ clienteId });
  return (
    <Secao titulo="Certificado digital" icone={BadgeCheck}>
      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : certs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum certificado cadastrado.{" "}
          <Link to={`/certificados?novo=${clienteId}`} className="underline">
            Cadastrar
          </Link>
        </p>
      ) : (
        <ul className="space-y-1.5">
          {certs.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-xs">
              <span className="flex-1 min-w-0 truncate">
                <span className="font-medium">{c.tipo}</span>
                <span className="text-muted-foreground"> · até {formatData(c.validoAte)}</span>
              </span>
              <CertificadoStatusBadge validoAte={c.validoAte} />
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

function SolicitacoesSecao({ chatRowId, onNova }: { chatRowId: string; onNova: () => void }) {
  const { data = [], isLoading } = useSolicitacoes({ chatRowId, status: "abertas" });
  const atualizar = useAtualizarSolicitacao();
  return (
    <Secao
      titulo="Chamados abertos"
      icone={ClipboardList}
      acao={
        <button
          type="button"
          onClick={onNova}
          className="inline-flex items-center gap-1 text-2xs font-medium text-primary hover:underline"
        >
          <Plus className="size-3" />
          Nova
        </button>
      }
    >
      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : data.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nada em aberto nesta conversa.</p>
      ) : (
        <ul className="space-y-2">
          {data.map((s) => (
            <li key={s.id} className="rounded-md border px-2.5 py-2 space-y-1.5">
              <div className="flex items-start gap-2">
                <p className="flex-1 min-w-0 text-xs font-medium">{s.tipo?.nome ?? "Chamado"}</p>
                <StatusSolicitacaoSelect
                  value={s.status}
                  disabled={atualizar.isPending}
                  onChange={(status) =>
                    atualizar.mutate(
                      { id: s.id, patch: { status } },
                      { onError: (e) => toast.error(msgErro(e)) },
                    )
                  }
                />
              </div>
              {s.descricao && <p className="text-2xs text-muted-foreground line-clamp-3">{s.descricao}</p>}
              <p className="text-2xs text-muted-foreground">
                {formatDataHora(s.criadoEm)}
                {s.prazo ? ` · prazo ${formatData(s.prazo)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link to="/chamados" className="block text-2xs text-muted-foreground hover:text-foreground underline">
        Ver todos os chamados
      </Link>
    </Secao>
  );
}

function AtendimentoSecao({ chat }: { chat: WhatsappChat }) {
  const mapa = useColaboradoresMap();
  const { data: historico = [], isLoading } = useTransferencias(chat.id);
  const resp = chat.responsavelId ? mapa.get(chat.responsavelId) : undefined;
  return (
    <Secao titulo="Atendimento" icone={ArrowRightLeft}>
      <div className="flex items-center gap-2 text-sm">
        {resp ? (
          <ColaboradorAvatar nome={resp.nome} cor={resp.cor} size="xs" />
        ) : (
          <SemResponsavelAvatar size="xs" />
        )}
        <span className="flex-1 min-w-0 truncate">{resp?.nome ?? "Sem responsável"}</span>
        <span className="text-2xs text-muted-foreground">{ATENDIMENTO_LABEL[chat.atendimentoStatus]}</span>
      </div>
      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : historico.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma transferência ainda.</p>
      ) : (
        <ol className="relative space-y-2.5 border-l pl-3 ml-1">
          {[...historico].reverse().map((t) => (
            <li key={t.id} className="text-xs">
              <span className="absolute -left-[4.5px] mt-1 size-2 rounded-full bg-border" aria-hidden />
              <p>{textoTransferencia(t, mapa)}</p>
              <p className="text-2xs text-muted-foreground">{formatDataHora(t.criadoEm)}</p>
            </li>
          ))}
        </ol>
      )}
    </Secao>
  );
}
