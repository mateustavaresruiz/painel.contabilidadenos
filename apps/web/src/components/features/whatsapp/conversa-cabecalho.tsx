// Cabeçalho da conversa aberta (redesenho no estilo Blip).
//
// Esquerda: avatar, nome inteiro, "Também aqui" (quem mais está com a conversa
// aberta, via Realtime) e a linha do telefone / "via <número>" / presença do
// contato. Direita: o chip do responsável com o estado (Na fila / Em
// atendimento / Finalizado), a ÚNICA ação principal do momento (botão azul da
// marca), "Abrir chamado" e o menu ⋮ com o resto, em itens com rótulo.
// No celular (em pé ou deitado) vira UMA linha: Voltar (44 px), avatar, nome
// numa linha e o ⋮. O chip do responsável, a ação principal (primeiro item),
// "Abrir chamado" e o resto vão para a folha de baixo, com alvos de 44 px:
// a tela fica para as mensagens.

import { format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft,
  ArrowRightLeft,
  CheckCircle2,
  Download,
  Eraser,
  Hand,
  Loader2,
  LogOut,
  MoreVertical,
  PanelRight,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { AvatarIniciais } from "@/components/avatar-iniciais";
import { ColaboradorAvatar, SemResponsavelAvatar } from "@/components/colaborador-avatar";
import { useAcoesAtendimento } from "@/components/features/atendimento/atendimento-acoes";
import {
  NovaSolicitacaoDialog,
  SolicitacaoBotaoSeAtivo,
  SolicitacaoTiposItem,
  usePodeAbrirChamadoNaConversa,
} from "@/components/features/solicitacoes/solicitacao-ui";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { useTelaCompacta } from "@/hooks/use-media-query";
import { avatarFicticio } from "@/lib/avatar-ficticio";
import { estadoAtendimento, type EstadoAtendimento } from "@/lib/atendimento-estado";
import { useEu, type Colaborador } from "@/lib/colaborador";
import { formatTelefone, parsePgTimestamp } from "@/lib/format";
import { iniciaisDeContato } from "@/lib/iniciais";
import { useModulos } from "@/lib/modulos";
import { usePresencaConversa, type PresencaConversa } from "@/lib/presenca-conversa";
import {
  mediaSignedUrl,
  usePresencaContato,
  type PresencaContato,
  type WhatsappChat,
  type WhatsappSessao,
} from "@/lib/queries/whatsapp";
import { cn } from "@/lib/utils";

import { ConversaTagsBotao } from "./conversa-tags";

type Props = {
  chat: WhatsappChat | undefined;
  chatId: string;
  sessao: WhatsappSessao | undefined;
  nome: string;
  numero: string | null;
  grupo: boolean;
  painelAberto: boolean;
  onTogglePainel: () => void;
  menuAberto: boolean;
  onMenuAbertoChange: (aberto: boolean) => void;
  onBaixar: () => void;
  onLimpar: () => void;
  onApagar: () => void;
  onSairGrupo: () => void;
  limpando: boolean;
  apagando: boolean;
  saindo: boolean;
  /** Celular: volta para a lista de conversas. */
  onVoltar?: () => void;
};

export function ConversaCabecalho(p: Props) {
  const { chat, grupo } = p;
  const { eu, tem } = useEu();
  const modulos = useModulos();
  const mobile = useTelaCompacta();
  const podeChamado = usePodeAbrirChamadoNaConversa();
  const [tipoChamado, setTipoChamado] = useState<string | null>(null);
  const acoes = useAcoesAtendimento(chat);
  const outros = usePresencaConversa(chat?.id, eu);
  const estado = estadoAtendimento(chat, eu?.id, tem, {
    transferenciaAtiva: modulos.ativo("transferenciaAtendimento"),
  });
  const comAtendimento = !!chat && !grupo;

  const principal = comAtendimento ? botaoPrincipal(estado, acoes) : null;

  const menuItens = (
    <ItensMenu
      {...p}
      estado={estado}
      comAtendimento={comAtendimento}
      mobile={mobile}
      onTransferir={() => {
        p.onMenuAbertoChange(false);
        acoes.abrirTransferir();
      }}
      onFinalizar={() => {
        p.onMenuAbertoChange(false);
        void acoes.finalizar();
      }}
    />
  );

  const botaoMenu = (
    <button
      type="button"
      className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label="Mais ações"
    >
      <MoreVertical className="size-[18px]" />
    </button>
  );

  const chip = comAtendimento ? (
    <ResponsavelChip estado={estado} responsavel={acoes.responsavel} eu={eu} />
  ) : null;

  const chamado = chat ? (
    <SolicitacaoBotaoSeAtivo origem={{ chatRowId: chat.id, clienteId: chat.clienteId, grupo: chat.tipo === "group" }} />
  ) : null;

  // ---- Celular: uma linha só; o resto na folha de baixo -------------------
  if (mobile) {
    return (
      <header className="shrink-0 border-b bg-card pt-safe-t shadow-[0_1px_3px_rgba(16,32,64,0.05)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.35)]">
        <div className="flex h-14 items-center gap-1 pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))]">
          {p.onVoltar ? (
            <button
              type="button"
              onClick={p.onVoltar}
              className="grid size-11 shrink-0 place-items-center rounded-full text-foreground transition-colors hover:bg-accent active:bg-accent"
              aria-label="Voltar para as conversas"
            >
              <ArrowLeft className="size-5" />
            </button>
          ) : (
            <span className="w-2 shrink-0" aria-hidden />
          )}
          <ConversaAvatar
            semente={chat?.chatId ?? p.nome}
            nome={chat?.nome}
            grupo={grupo}
            fotoPath={chat?.fotoPath}
            compacto
          />
          <button
            type="button"
            onClick={() => p.onMenuAbertoChange(true)}
            className="ml-1.5 flex min-h-11 min-w-0 flex-1 flex-col justify-center text-left"
            aria-label={`${p.nome}: ações da conversa`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-foreground">
                {p.nome}
              </span>
              {chat?.clienteId ? (
                <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-primary">
                  Cliente
                </span>
              ) : null}
            </span>
            <SublinhaCompacta chat={chat} estado={comAtendimento ? estado : null} responsavel={acoes.responsavel} numero={p.numero} nome={p.nome} grupo={grupo} outros={outros.length} />
          </button>
          <button
            type="button"
            onClick={() => p.onMenuAbertoChange(true)}
            className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Mais ações"
          >
            <MoreVertical className="size-5" />
          </button>
        </div>

        <Sheet open={p.menuAberto} onOpenChange={p.onMenuAbertoChange}>
          <SheetContent side="bottom" className="bg-card px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
            <SheetTitle className="sr-only">Ações da conversa</SheetTitle>
            <SheetDescription className="sr-only">Opções para esta conversa.</SheetDescription>
            <div className="min-h-0 overflow-y-auto overscroll-contain">
              {(chip || outros.length > 0) && (
                <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2 pt-1">
                  {chip}
                  <TambemAqui outros={outros} />
                </div>
              )}
              {principal && (
                <div className="px-1 pb-1.5">
                  <Button
                    onClick={() => {
                      p.onMenuAbertoChange(false);
                      principal.onClick();
                    }}
                    disabled={acoes.ocupado || !eu}
                    className="h-11 w-full"
                    title={principal.dica}
                  >
                    {acoes.ocupado ? <Loader2 className="animate-spin" /> : principal.icone}
                    {principal.rotulo}
                  </Button>
                </div>
              )}
              {chat && podeChamado && (
                <SolicitacaoTiposItem
                  onEscolher={(id) => {
                    p.onMenuAbertoChange(false);
                    setTipoChamado(id);
                  }}
                />
              )}
              {menuItens}
            </div>
          </SheetContent>
        </Sheet>
        {chat && (
          <NovaSolicitacaoDialog
            open={!!tipoChamado}
            onOpenChange={(o) => !o && setTipoChamado(null)}
            tipoIdInicial={tipoChamado}
            origem={{ chatRowId: chat.id, clienteId: chat.clienteId, grupo: chat.tipo === "group" }}
          />
        )}
        {acoes.dialogoTransferir}
      </header>
    );
  }

  // ---- Desktop e tablet: tudo na mesma linha (como sempre) ----------------
  const botaoPrimario = principal ? (
    <Button
      onClick={principal.onClick}
      disabled={acoes.ocupado || !eu}
      className="md:h-9"
      title={principal.dica}
    >
      {acoes.ocupado ? <Loader2 className="animate-spin" /> : principal.icone}
      {principal.rotulo}
    </Button>
  ) : null;

  return (
    <header className="shrink-0 border-b bg-card shadow-[0_1px_3px_rgba(16,32,64,0.05)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.35)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-3 py-2.5 md:px-4 md:py-3">
        <ConversaAvatar
          semente={chat?.chatId ?? p.nome}
          nome={chat?.nome}
          grupo={grupo}
          fotoPath={chat?.fotoPath}
        />

        <div className="min-w-0 flex-1 basis-[calc(100%-7rem)] md:min-w-[11rem] md:basis-[11rem]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="min-w-0 break-words text-[15px] font-semibold leading-tight tracking-[-0.01em] text-foreground md:text-base">
              {p.nome}
            </h2>
            {chat?.clienteId ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium leading-none text-primary">
                Cliente
              </span>
            ) : null}
            <TambemAqui outros={outros} />
          </div>
          <Sublinha chat={chat} sessao={p.sessao} numero={p.numero} nome={p.nome} grupo={grupo} />
        </div>

        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2 md:ml-auto">
          {chip}
          {botaoPrimario}
          {chamado}
          <Popover open={p.menuAberto} onOpenChange={p.onMenuAbertoChange}>
            <PopoverTrigger asChild>{botaoMenu}</PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-1.5">
              {menuItens}
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {acoes.dialogoTransferir}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Ação principal
// ---------------------------------------------------------------------------

type Acoes = ReturnType<typeof useAcoesAtendimento>;

function botaoPrincipal(
  estado: EstadoAtendimento,
  acoes: Acoes,
): { rotulo: string; icone: ReactNode; onClick: () => void; dica: string } | null {
  switch (estado.principal) {
    case "assumir":
      return { rotulo: "Assumir", icone: <Hand />, onClick: () => void acoes.assumir(), dica: "Ficar como responsável por esta conversa" };
    case "tomar":
      return { rotulo: "Assumir conversa", icone: <Hand />, onClick: () => void acoes.tomar(), dica: "Assumir no lugar de quem está atendendo" };
    case "finalizar":
      return { rotulo: "Finalizar", icone: <CheckCircle2 />, onClick: () => void acoes.finalizar(), dica: "Encerrar o atendimento" };
    case "reabrir":
      return { rotulo: "Reabrir", icone: <RotateCcw />, onClick: () => void acoes.reabrir(), dica: "Reabrir o atendimento em seu nome" };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Chip do responsável
// ---------------------------------------------------------------------------

const TOM = {
  fila: {
    rotulo: "Na fila",
    caixa: "border-warning/35 bg-warning/10",
    ponto: "bg-warning",
  },
  em_atendimento: {
    rotulo: "Em atendimento",
    caixa: "border-primary/30 bg-primary/5",
    ponto: "bg-primary",
  },
  finalizado: {
    rotulo: "Finalizado",
    caixa: "border-success/35 bg-success/10",
    ponto: "bg-success",
  },
} as const;

export function ResponsavelChip({
  estado,
  responsavel,
  eu,
  className,
}: {
  estado: Pick<EstadoAtendimento, "fase" | "meu">;
  responsavel: Colaborador | undefined;
  eu: Colaborador | null;
  className?: string;
}) {
  const tom = TOM[estado.fase];
  const nome = estado.fase === "fila"
    ? "Sem responsável"
    : estado.meu
    ? "Você"
    : responsavel?.nome ?? "Alguém";
  return (
    <Tooltip
      label={
        responsavel
          ? `${tom.rotulo} · ${responsavel.nome}${estado.meu && eu ? " (você)" : ""}`
          : tom.rotulo
      }
      side="bottom"
    >
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3.5",
          tom.caixa,
          className,
        )}
      >
        {responsavel && estado.fase !== "fila" ? (
          <ColaboradorAvatar nome={responsavel.nome} cor={responsavel.cor} size="sm" />
        ) : (
          <SemResponsavelAvatar size="sm" />
        )}
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", tom.ponto)} aria-hidden />
            {tom.rotulo}
          </span>
          <span className="max-w-[9.5rem] truncate text-xs font-medium text-foreground">{nome}</span>
        </span>
      </span>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Presença: quem mais está na conversa
// ---------------------------------------------------------------------------

function TambemAqui({ outros }: { outros: PresencaConversa[] }) {
  if (!outros.length) return null;
  const nomes = outros.map((o) => o.nome.split(" ")[0]);
  const texto = nomes.length <= 2 ? nomes.join(" e ") : `${nomes.slice(0, 2).join(", ")} e mais ${nomes.length - 2}`;
  return (
    <Tooltip label={`Também com a conversa aberta: ${outros.map((o) => o.nome).join(", ")}`} side="bottom">
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-success/30 bg-success/10 py-0.5 pl-1 pr-2.5">
        <span className="flex -space-x-1.5">
          {outros.slice(0, 3).map((o) => (
            <ColaboradorAvatar
              key={o.colaboradorId}
              nome={o.nome}
              cor={o.cor}
              size="xs"
              className="ring-2 ring-card"
            />
          ))}
        </span>
        <span className="truncate text-2xs font-medium text-foreground/80">
          <span className="text-muted-foreground">Também aqui: </span>
          {texto}
        </span>
      </span>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Sublinha: telefone · via número · presença do contato
// ---------------------------------------------------------------------------

// "digitando…/gravando…" obsoleto após esta janela (caso falte o evento de
// saída); "online" obsoleto um pouco depois. Aí cai para "visto por último".
const PRESENCA_TYPING_TTL_MS = 18_000;
const PRESENCA_ONLINE_TTL_MS = 90_000;

function presencaTexto(
  chat: WhatsappChat | undefined,
  presenca: PresencaContato | null | undefined,
): { texto: string; ativo: boolean } | null {
  if (!chat || chat.tipo !== "individual" || !presenca) return null;
  const em = parsePgTimestamp(presenca.estadoEm)?.getTime() ?? 0;
  const idade = Date.now() - em;
  const est = presenca.estado;
  if ((est === "typing" || est === "recording") && idade < PRESENCA_TYPING_TTL_MS) {
    return { texto: est === "recording" ? "gravando áudio…" : "digitando…", ativo: true };
  }
  if (est === "online" && idade < PRESENCA_ONLINE_TTL_MS) return { texto: "online", ativo: true };
  const visto = presenca.ultimoVistoEm ? parsePgTimestamp(presenca.ultimoVistoEm) : null;
  if (visto) {
    const quando = isSameDay(visto, new Date())
      ? `às ${format(visto, "HH:mm")}`
      : `em ${format(visto, "dd/MM 'às' HH:mm", { locale: ptBR })}`;
    return { texto: `visto por último ${quando}`, ativo: false };
  }
  return null;
}

function formatHeaderNumero(numero: string | null): string | null {
  if (!numero) return null;
  const d = numero.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith("55")) return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  return numero;
}

function Sublinha({
  chat,
  sessao,
  numero,
  nome,
  grupo,
}: {
  chat: WhatsappChat | undefined;
  sessao: WhatsappSessao | undefined;
  numero: string | null;
  nome: string;
  grupo: boolean;
}) {
  // Tick próprio: expira "digitando…" sem re-renderizar a conversa inteira.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 8_000);
    return () => clearInterval(id);
  }, []);

  const { data: presenca } = usePresencaContato(chat?.id, chat?.tipo === "individual");
  const pres = presencaTexto(chat, presenca);
  const telefone = !grupo && numero && formatTelefone(numero) !== nome ? formatTelefone(numero) : null;
  const via = sessao ? sessao.apelido ?? formatHeaderNumero(sessao.numero) ?? "WhatsApp" : null;

  return (
    <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      {telefone && <span className="nums">{telefone}</span>}
      {telefone && via && <span aria-hidden>·</span>}
      {sessao && via && (
        <span className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              sessao.status === "WORKING" && "bg-success",
              sessao.status === "STARTING" && "animate-pulse bg-warning",
              sessao.status === "FAILED" && "bg-destructive",
              sessao.status === "STOPPED" && "bg-muted-foreground/40",
            )}
            aria-hidden
          />
          <span>
            via <span className="font-medium text-foreground/75">{via}</span>
          </span>
        </span>
      )}
      {pres && (
        <>
          <span aria-hidden>·</span>
          <span className={cn("inline-flex items-center gap-1.5", pres.ativo && "font-medium text-success")}>
            {pres.ativo && <span className="size-1.5 animate-pulse rounded-full bg-success" aria-hidden />}
            {pres.texto}
          </span>
        </>
      )}
    </p>
  );
}

/**
 * Sublinha do cabeçalho de uma linha (celular): o estado do atendimento
 * (o chip foi para a folha) e a presença do contato, numa linha que corta.
 */
function SublinhaCompacta({
  chat,
  estado,
  responsavel,
  numero,
  nome,
  grupo,
  outros,
}: {
  chat: WhatsappChat | undefined;
  estado: EstadoAtendimento | null;
  responsavel: Colaborador | undefined;
  numero: string | null;
  nome: string;
  grupo: boolean;
  outros: number;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 8_000);
    return () => clearInterval(id);
  }, []);
  const { data: presenca } = usePresencaContato(chat?.id, chat?.tipo === "individual");
  const pres = presencaTexto(chat, presenca);
  const tom = estado ? TOM[estado.fase] : null;
  const quem = !estado
    ? null
    : estado.fase === "fila"
    ? null
    : estado.meu
    ? "você"
    : responsavel?.nome.split(" ")[0] ?? null;
  const telefone = !grupo && numero && formatTelefone(numero) !== nome ? formatTelefone(numero) : null;
  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs leading-tight text-muted-foreground">
      {tom && <span className={cn("size-1.5 shrink-0 rounded-full", tom.ponto)} aria-hidden />}
      <span className="min-w-0 truncate">
        {[
          tom ? (quem ? `${tom.rotulo} · ${quem}` : tom.rotulo) : null,
          pres?.ativo ? pres.texto : null,
          !tom && !pres?.ativo ? telefone : null,
          outros > 0 ? `+${outros} aqui` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Menu ⋮ (popover no desktop, folha de baixo no celular)
// ---------------------------------------------------------------------------

function Item({
  icone,
  rotulo,
  onClick,
  disabled,
  perigo,
  sufixo,
}: {
  icone: ReactNode;
  rotulo: string;
  onClick: () => void;
  disabled?: boolean;
  perigo?: boolean;
  sufixo?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-50 toque:min-h-11",
        perigo ? "text-destructive hover:bg-destructive/10" : "hover:bg-accent",
      )}
    >
      <span className={cn("[&_svg]:size-4", perigo ? "" : "text-muted-foreground")}>{icone}</span>
      <span className="flex-1">{rotulo}</span>
      {sufixo}
    </button>
  );
}

function Divisor() {
  return <div className="my-1 h-px bg-border/70" role="separator" />;
}

function ItensMenu(
  p: Props & {
    estado: EstadoAtendimento;
    comAtendimento: boolean;
    mobile: boolean;
    onTransferir: () => void;
    onFinalizar: () => void;
  },
) {
  const { tem } = useEu();
  const { chat, grupo, estado } = p;
  const finalizarNoMenu = p.comAtendimento && estado.podeFinalizar && estado.principal !== "finalizar";
  const grupoAtendimento = (p.comAtendimento && estado.podeTransferir) || finalizarNoMenu;
  const grupoVer = !grupo || !!chat;
  const podeApagar = tem("whatsapp.apagar_mensagens");
  const podeSair = chat?.tipo === "group" && tem("whatsapp.conexoes");

  return (
    <div className="flex flex-col">
      {grupoAtendimento && (
        <>
          {p.comAtendimento && estado.podeTransferir && (
            <Item icone={<ArrowRightLeft />} rotulo="Transferir atendimento…" onClick={p.onTransferir} />
          )}
          {finalizarNoMenu && (
            <Item icone={<CheckCircle2 />} rotulo="Finalizar atendimento" onClick={p.onFinalizar} />
          )}
          <Divisor />
        </>
      )}
      {grupoVer && chat && <ConversaTagsBotao chatId={chat.id} variante="item" />}
      {!grupo && (
        <Item
          icone={<PanelRight />}
          rotulo={p.painelAberto ? "Esconder perfil e histórico" : "Perfil e histórico"}
          onClick={() => {
            p.onMenuAbertoChange(false);
            p.onTogglePainel();
          }}
        />
      )}
      {tem("whatsapp.exportar") && (
        <Item
          icone={<Download />}
          rotulo="Baixar conversa"
          onClick={() => {
            p.onMenuAbertoChange(false);
            p.onBaixar();
          }}
        />
      )}
      {(podeApagar || podeSair) && <Divisor />}
      {podeApagar && (
        <Item icone={<Eraser />} rotulo="Limpar mensagens" onClick={p.onLimpar} disabled={p.limpando} />
      )}
      {podeSair && (
        <Item icone={<LogOut />} rotulo="Sair do grupo" onClick={p.onSairGrupo} disabled={p.saindo} perigo />
      )}
      {podeApagar && (
        <Item icone={<Trash2 />} rotulo="Excluir conversa" onClick={p.onApagar} disabled={p.apagando} perigo />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avatar do contato
// ---------------------------------------------------------------------------

function ConversaAvatar({
  semente,
  nome,
  grupo,
  fotoPath,
  compacto = false,
}: {
  /** Identificador do chat (JID). É a semente do desenho, NUNCA o nome. */
  semente: string;
  nome?: string | null;
  grupo: boolean;
  fotoPath?: string | null;
  /** Cabeçalho de uma linha do celular: 36 px. */
  compacto?: boolean;
}) {
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

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-medium",
        compacto ? "size-9" : "size-10 md:size-11",
        grupo ? "bg-foreground/[0.06] text-foreground" : "bg-primary/15 text-primary",
      )}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          onError={() => setPhotoUrl(null)}
        />
      ) : grupo ? (
        <Users className="size-4" />
      ) : iniciaisDeContato(nome) ? (
        <AvatarIniciais nome={nome} semente={semente} className="size-full text-xs" />
      ) : (
        <img src={avatarFicticio(semente)} alt="" className="size-full" loading="lazy" />
      )}
    </span>
  );
}
