import {
  ArrowRightLeft,
  BadgeCheck,
  ClipboardList,
  History,
  ExternalLink,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Unlink,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "@/lib/toast";

import { ColaboradorAvatar, SemResponsavelAvatar } from "@/components/colaborador-avatar";
import { CertificadoStatusBadge } from "@/components/features/certificados/certificado-status";
import { CadastroIncompletoBadge } from "@/components/features/clientes/cadastro-incompleto-badge";
import { textoTransferencia } from "@/components/features/atendimento/atendimento-acoes";
import {
  NovaSolicitacaoDialog,
  StatusSolicitacaoSelect,
  useTrocarStatusChamado,
} from "@/components/features/solicitacoes/solicitacao-ui";
import { Button } from "@/components/ui/button";
import { HistoricoLista } from "@/components/features/auditoria/linha-do-tempo";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useColaboradoresMap, usePermissao } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { formatData, formatDataHora, formatDoc, formatTelefone, linkWaMe } from "@/lib/format";
import { useModulos } from "@/lib/modulos";
import { ATENDIMENTO_LABEL, useTransferencias } from "@/lib/queries/atendimento";
import { useCertificados } from "@/lib/queries/certificados";
import {
  nomeExibicao,
  razaoSocialDeApoio,
  useCliente,
  useClientesPorTelefone,
  useSocios,
} from "@/lib/queries/clientes";
import { useSolicitacoes } from "@/lib/queries/solicitacoes";
import { mediaSignedUrl, type WhatsappChat } from "@/lib/queries/whatsapp";
import { iniciaisDeContato } from "@/lib/iniciais";
import { cn } from "@/lib/utils";

import { VincularClienteDialog } from "./vincular-cliente-dialog";

type Props = {
  clienteId: string | null;
  /** Foto do contato (ex.: `fotoPath` do WhatsApp) pro avatar do painel. */
  fotoPath?: string | null;
  canal: "whatsapp" | "email";
  /** Identificador da conversa (chatId do WhatsApp ou threadId do e-mail). */
  conversaId: string;
  /** Sugestão para pré-preencher a busca de cliente (telefone ou e-mail). */
  sugestao?: string | null;
  /** Nome do contato (ex.: pushName do WhatsApp) para pré-preencher o
   *  cadastro ao criar cliente novo. */
  nomeSugerido?: string | null;
  /** Vincula a conversa a um cliente (ou desvincula passando null). */
  onVincular: (clienteId: string | null) => Promise<void> | void;
  vinculando?: boolean;
  /**
   * Painel Denos: a conversa (para chamados e histórico do atendimento).
   * No adv3 aqui entravam processos/tarefas/receitas/documentos.
   */
  chat?: WhatsappChat;
  /** Fecha o painel em mobile/tablet (em desktop fica fixo). */
  onClose?: () => void;
  /** Celular: o mesmo conteúdo dentro de uma folha de baixo (ocupa a largura toda). */
  emFolha?: boolean;
};

/**
 * Painel lateral direito da conversa que mostra o contexto do cliente
 * vinculado (porte literal do adv3). Sem cliente vinculado, oferece um
 * botão para vincular via busca.
 *
 * Dados exibidos quando vinculado (painel Denos):
 *   - Identidade (nome, contato, link pro cadastro)
 *   - Sócios (PJ)
 *   - Certificado digital
 *   - Chamados abertos da conversa
 *   - Atendimento: responsável e transferências
 */
export function ClientContextPanel({
  clienteId,
  fotoPath,
  canal,
  conversaId,
  sugestao,
  nomeSugerido,
  onVincular,
  vinculando,
  chat,
  onClose,
  emFolha = false,
}: Props) {
  const [vincularOpen, setVincularOpen] = useState(false);
  const [novaSolicitacao, setNovaSolicitacao] = useState(false);
  const [aba, setAba] = useState<"perfil" | "historico">("perfil");
  const podeCriarChamado = usePermissao("chamados.criar");
  const chamadoNaConversa = useModulos().ativo("chamadoNaConversa") && podeCriarChamado;

  return (
    // Ao lado da conversa só em md+. No celular a conversa abre este mesmo
    // conteúdo numa folha de baixo (emFolha), pelo item "Perfil e histórico".
    <aside
      className={cn(
        "flex-col min-h-0",
        emFolha
          ? "flex w-full flex-1"
          : "hidden md:flex w-80 lg:w-96 shrink-0 border-l bg-card/30 h-full",
      )}
    >
      <header className="px-4 h-14 shrink-0 border-b flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MessageCircle className="size-4 text-foreground shrink-0" />
          <p className="text-sm font-medium truncate">Perfil do cliente</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="grid place-items-center size-8 toque:size-11 rounded-md hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors -mr-2"
            aria-label="Fechar painel"
          >
            <X className="size-4" />
          </button>
        )}
      </header>

      <Tabs
        value={aba}
        onValueChange={(v) => setAba(v as "perfil" | "historico")}
        className="flex min-h-0 flex-1 flex-col"
      >
        {chat && (
          <div className="shrink-0 border-b px-4 py-2.5">
            <TabsList className="w-full">
              <TabsTrigger value="perfil" className="flex-1">
                Perfil
              </TabsTrigger>
              <TabsTrigger value="historico" className="flex-1">
                <History />
                Histórico
              </TabsTrigger>
            </TabsList>
          </div>
        )}
      <TabsContent value="perfil" className="mt-0 flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {clienteId ? (
          <ClienteVinculado
            clienteId={clienteId}
            fotoPath={fotoPath ?? null}
            onDesvincular={() => onVincular(null)}
            desvinculando={vinculando}
            onNovoChamado={chamadoNaConversa ? () => setNovaSolicitacao(true) : undefined}
          />
        ) : (
          <SemCliente
            canal={canal}
            sugestao={sugestao ?? null}
            onAbrirVincular={() => setVincularOpen(true)}
            onVincular={onVincular}
            vinculando={vinculando}
          />
        )}

        {/* Painel Denos: chamados e atendimento valem com ou sem cliente. */}
        {chat && (
          <div className="px-4 pb-4 space-y-4">
            {chamadoNaConversa && (
              <ChamadosSection chatRowId={chat.id} onNova={() => setNovaSolicitacao(true)} />
            )}
            <AtendimentoSection chat={chat} />
          </div>
        )}
      </TabsContent>
      {chat && (
        <TabsContent value="historico" className="mt-0 flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 pt-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Quem assumiu, transferiu e finalizou, cliente vinculado, etiquetas e chamados desta conversa.
          </p>
          <HistoricoLista
            entidade="conversa"
            id={chat.id}
            vazio="Nada registrado nesta conversa ainda. Assumir, transferir, finalizar, etiquetar e abrir chamado aparecem aqui."
          />
        </TabsContent>
      )}
      </Tabs>

      <VincularClienteDialog
        open={vincularOpen}
        onOpenChange={setVincularOpen}
        canal={canal}
        conversaId={conversaId}
        sugestao={sugestao ?? null}
        nomeSugerido={nomeSugerido ?? null}
        onConfirmar={async (id) => {
          try {
            await onVincular(id);
            toast.success("Cliente vinculado");
            setVincularOpen(false);
          } catch (err) {
            toast.error(msgErro(err));
          }
        }}
      />
      {chat && (
        <NovaSolicitacaoDialog
          open={novaSolicitacao}
          onOpenChange={setNovaSolicitacao}
          origem={{ chatRowId: chat.id, clienteId: chat.clienteId, grupo: chat.tipo === "group" }}
        />
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Estado: sem cliente vinculado
// ---------------------------------------------------------------------------

function SemCliente({
  canal,
  sugestao,
  onAbrirVincular,
  onVincular,
  vinculando,
}: {
  canal: "whatsapp" | "email";
  sugestao: string | null;
  onAbrirVincular: () => void;
  onVincular: (clienteId: string | null) => Promise<void> | void;
  vinculando?: boolean;
}) {
  // Painel Denos: cadastro que já tem este telefone vira atalho de 1 clique.
  const sugestoes = useClientesPorTelefone(canal === "whatsapp" && sugestao ? sugestao : undefined);
  return (
    <div className="p-6 text-center space-y-3 mt-6">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
        <UserPlus className="size-5" />
      </div>
      <div>
        <p className="text-sm font-medium">Conversa sem cliente</p>
        <p className="text-xs text-muted-foreground mt-1">
          Vincule esta {canal === "whatsapp" ? "conversa" : "thread"} a um
          cliente para ver sócios, certificado e chamados aqui.
        </p>
      </div>
      {sugestao && (
        <p className="text-2xs text-muted-foreground bg-muted/40 rounded-md py-1.5 px-2 inline-block">
          {canal === "whatsapp" ? "Número:" : "E-mail:"}{" "}
          <span className="font-mono">{sugestao}</span>
        </p>
      )}
      {sugestoes.data && sugestoes.data.length > 0 && (
        <ul className="space-y-1.5 text-left">
          {sugestoes.data.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5"
            >
              <span className="flex-1 min-w-0 text-xs font-medium truncate">{nomeExibicao(c)}</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={vinculando}
                onClick={() => void onVincular(c.id)}
              >
                Vincular
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" onClick={onAbrirVincular} className="mt-2">
        <UserPlus className="size-4 mr-1.5" />
        Vincular a cliente
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado: cliente vinculado
// ---------------------------------------------------------------------------

function ClienteVinculado({
  clienteId,
  fotoPath,
  onDesvincular,
  desvinculando,
  onNovoChamado,
}: {
  clienteId: string;
  fotoPath?: string | null;
  onDesvincular: () => void;
  desvinculando?: boolean;
  onNovoChamado?: () => void;
}) {
  const { data: cliente, isLoading } = useCliente(clienteId);
  // Foto do contato (WhatsApp) → signed URL, com fallback pras iniciais.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const temFoto = fotoPath && fotoPath !== "__none__";
  useEffect(() => {
    if (!temFoto) {
      setPhotoUrl(null);
      return;
    }
    let cancel = false;
    mediaSignedUrl(fotoPath!).then((url) => {
      if (!cancel) setPhotoUrl(url);
    });
    return () => {
      cancel = true;
    };
  }, [fotoPath, temFoto]);

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!cliente) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        <p>Cliente não encontrado.</p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={onDesvincular}
        >
          Desvincular
        </Button>
      </div>
    );
  }

  const nome = nomeExibicao(cliente);

  return (
    <div className="p-4 space-y-4">
      {/* Cabeçalho do cliente */}
      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="relative grid place-items-center size-12 rounded-full bg-foreground/[0.06] text-foreground text-base font-semibold shrink-0 ring-1 ring-foreground/25 overflow-hidden">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt=""
                className="size-full object-cover"
                loading="lazy"
                onError={() => setPhotoUrl(null)}
              />
            ) : (
              iniciais(nome)
            )}
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="font-semibold text-sm leading-tight">
              {nome}
            </p>
            {razaoSocialDeApoio(cliente) && (
              <p className="text-2xs text-muted-foreground leading-tight">{cliente.nome}</p>
            )}
            {cliente.provisorio && (
              <Link to={`/clientes/${cliente.id}/editar`} className="inline-flex" title="Completar cadastro">
                <CadastroIncompletoBadge />
              </Link>
            )}
            <p className="text-2xs text-muted-foreground">
              {cliente.tipo === "PF" ? "Pessoa física" : "Pessoa jurídica"}
              {cliente.cpfCnpj ? ` · ${formatDoc(cliente.cpfCnpj)}` : ""}
            </p>
            {cliente.cidade || cliente.estado ? (
              <p className="flex items-center gap-1 text-2xs text-muted-foreground">
                <MapPin className="size-3 shrink-0" />
                {[cliente.cidade, cliente.estado].filter(Boolean).join(" / ")}
              </p>
            ) : null}
          </div>
        </div>

        {/* Ações rápidas — WhatsApp, cadastro e (painel Denos) abrir chamado */}
        <div className={cn("grid gap-1.5", onNovoChamado ? "grid-cols-3" : "grid-cols-2")}>
          <QuickAction
            icon={MessageCircle}
            label="WhatsApp"
            href={linkWaMe(cliente.telefone) ?? undefined}
            external
          />
          <QuickAction icon={ExternalLink} label="Cadastro" to={`/clientes/${cliente.id}`} />
          {onNovoChamado ? (
            <QuickAction icon={ClipboardList} label="Chamado" onClick={onNovoChamado} />
          ) : null}
        </div>
      </section>

      {cliente.tipo === "PJ" && <SociosSection clienteId={cliente.id} />}
      <CertificadosSection clienteId={cliente.id} />

      <Button
        variant="ghost"
        size="sm"
        className="w-full text-muted-foreground hover:text-destructive"
        onClick={onDesvincular}
        disabled={desvinculando}
      >
        {desvinculando ? (
          <Loader2 className="size-3.5 animate-spin mr-1.5" />
        ) : (
          <Unlink className="size-3.5 mr-1.5" />
        )}
        Desvincular conversa
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seções
// ---------------------------------------------------------------------------

function SectionHeader({
  icon: Icon,
  titulo,
  contagem,
  href,
  acao,
}: {
  icon: typeof Users;
  titulo: string;
  contagem?: number;
  href?: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        <Icon className="size-3.5" />
        {titulo}
        {typeof contagem === "number" && contagem > 0 && (
          <span className="text-foreground">({contagem})</span>
        )}
      </div>
      {acao}
      {href && (
        <Link
          to={href}
          className="text-2xs text-primary hover:underline"
        >
          ver todos
        </Link>
      )}
    </div>
  );
}

function SociosSection({ clienteId }: { clienteId: string }) {
  const { data: socios = [], isLoading } = useSocios(clienteId);

  return (
    <section className="border-t pt-4">
      <SectionHeader
        icon={Users}
        titulo="Sócios"
        contagem={socios.length}
        href={`/clientes/${clienteId}?aba=socios`}
      />
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : socios.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Nenhum sócio cadastrado.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {socios.slice(0, 5).map((s) => (
            <li
              key={s.id}
              className="block rounded-md border bg-card px-2.5 py-1.5"
            >
              <p className="text-xs font-medium truncate">{s.nome}</p>
              <div className="flex items-center gap-2 mt-0.5 text-2xs text-muted-foreground">
                {s.administrador && (
                  <span className="inline-flex items-center gap-1 text-foreground">
                    <span className="size-1.5 rounded-full bg-current" />
                    Administrador
                  </span>
                )}
                {s.participacao != null && <span>{s.participacao}%</span>}
                {s.telefone && (
                  <span className="inline-flex items-center gap-1 truncate">
                    <Phone className="size-3 shrink-0" />
                    {formatTelefone(s.telefone)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CertificadosSection({ clienteId }: { clienteId: string }) {
  const { data: certs = [], isLoading } = useCertificados({ clienteId });

  return (
    <section className="border-t pt-4">
      <SectionHeader
        icon={BadgeCheck}
        titulo="Certificado digital"
        contagem={certs.length}
        href="/certificados"
      />
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : certs.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Nenhum certificado cadastrado.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {certs.slice(0, 3).map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{c.tipo}</p>
                <p className="text-2xs text-muted-foreground">
                  até {formatData(c.validoAte)}
                </p>
              </div>
              <CertificadoStatusBadge validoAte={c.validoAte} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChamadosSection({ chatRowId, onNova }: { chatRowId: string; onNova: () => void }) {
  const { data = [], isLoading } = useSolicitacoes({ chatRowId, status: "abertas" });
  const { trocar, pendente } = useTrocarStatusChamado();

  return (
    <section className="border-t pt-4">
      <SectionHeader icon={ClipboardList} titulo="Chamados" contagem={data.length} href="/chamados" />
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : data.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Nenhum chamado aberto.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {data.slice(0, 5).map((s) => (
            <li
              key={s.id}
              className="block rounded-md border bg-card px-2.5 py-1.5"
            >
              <div className="flex items-start gap-2">
                <p className="flex-1 min-w-0 text-xs font-medium truncate">{s.tipo?.nome ?? "Chamado"}</p>
                <StatusSolicitacaoSelect
                  value={s.status}
                  disabled={pendente}
                  onChange={(status) => trocar(s.id, s.status, status)}
                />
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-2xs text-muted-foreground">
                <span>{formatDataHora(s.criadoEm)}</span>
                {s.prazo ? <span>prazo {formatData(s.prazo)}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="outline"
        size="sm"
        className="w-full mt-2"
        onClick={onNova}
      >
        <Plus className="size-4 mr-1.5" />
        Abrir chamado
      </Button>
    </section>
  );
}

function AtendimentoSection({ chat }: { chat: WhatsappChat }) {
  const mapa = useColaboradoresMap();
  const { data: historico = [], isLoading } = useTransferencias(chat.id);
  const resp = chat.responsavelId ? mapa.get(chat.responsavelId) : undefined;

  return (
    <section className="border-t pt-4">
      <SectionHeader icon={ArrowRightLeft} titulo="Atendimento" contagem={historico.length} />
      <div className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5">
        {resp ? (
          <ColaboradorAvatar nome={resp.nome} cor={resp.cor} size="xs" />
        ) : (
          <SemResponsavelAvatar size="xs" />
        )}
        <span className="flex-1 min-w-0 text-xs font-medium truncate">
          {resp?.nome ?? "Sem responsável"}
        </span>
        <span className="text-2xs text-muted-foreground">{ATENDIMENTO_LABEL[chat.atendimentoStatus]}</span>
      </div>
      {isLoading ? (
        <Skeleton className="h-16 w-full mt-2" />
      ) : historico.length === 0 ? (
        <p className="text-xs text-muted-foreground italic mt-2">
          Nenhuma transferência ainda.
        </p>
      ) : (
        <ul className="space-y-1.5 mt-2">
          {[...historico].reverse().slice(0, 5).map((t) => (
            <li key={t.id} className="text-xs">
              <p>{textoTransferencia(t, mapa)}</p>
              <p className="text-2xs text-muted-foreground">{formatDataHora(t.criadoEm)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Botão compacto de ação rápida (ícone + rótulo). Vira <a> quando tem
 * href, <Link> com `to`, senão <button> com onClick. Desabilita visualmente
 * quando não há destino (ex.: cliente sem telefone/e-mail).
 */
function QuickAction({
  icon: Icon,
  label,
  href,
  to,
  onClick,
  external,
}: {
  icon: typeof Phone;
  label: string;
  href?: string;
  to?: string;
  onClick?: () => void;
  external?: boolean;
}) {
  const base =
    "flex flex-col items-center justify-center gap-1 rounded-lg border bg-card px-1 py-2 text-2xs font-medium transition-colors";
  const enabled = "text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-foreground/5";
  const disabled = "text-muted-foreground/40 cursor-not-allowed";

  if (href) {
    return (
      <a
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className={cn(base, enabled)}
        title={label}
      >
        <Icon className="size-4" />
        {label}
      </a>
    );
  }
  if (to) {
    return (
      <Link to={to} className={cn(base, enabled)} title={label}>
        <Icon className="size-4" />
        {label}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(base, enabled)} title={label}>
        <Icon className="size-4" />
        {label}
      </button>
    );
  }
  return (
    <span className={cn(base, disabled)} aria-disabled title={`${label} indisponível`}>
      <Icon className="size-4" />
      {label}
    </span>
  );
}

function iniciais(nome: string): string {
  // Só palavras com letra: "William Cruz Advogado ..." não vira "W.".
  return iniciaisDeContato(nome) ?? "?";
}
