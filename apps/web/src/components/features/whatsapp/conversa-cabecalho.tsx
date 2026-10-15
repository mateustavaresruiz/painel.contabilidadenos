// Cabeçalho da conversa aberta (redesenho no estilo Blip).
//
// Esquerda: avatar, nome inteiro, "Também aqui" (quem mais está com a conversa
// aberta, via Realtime) e a linha do telefone / "via <número>" / presença do
// contato. Direita: o chip do responsável com o estado (Na fila / Em
// atendimento / Finalizado), a ÚNICA ação principal do momento (botão azul da
// marca), "Abrir chamado" e o menu ⋮ com o resto, em itens com rótulo.
// No celular empilha: nome e menu em cima, chip + ação principal embaixo, e o
// menu vira uma folha de baixo com alvos de 44 px.

import { format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
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
import { SolicitacaoBotaoSeAtivo } from "@/components/features/solicitacoes/solicitacao-ui";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-media-query";
import { avatarFicticio } from "@/lib/avatar-ficticio";
import { estadoAtendimento, type EstadoAtendimento } from "@/lib/atendimento-estado";
import { useEu, type Colaborador } from "@/lib/colaborador";
import { formatTelefone, parsePgTimestamp } from "@/lib/format";
import { iniciaisDeContato } from "@/lib/iniciais";
import { useModulos } from "@/lib/modulos";
import { usePresencaConversa, type PresencaConversa } from "@/lib/presenca-conversa";
import { mediaSignedUrl, type WhatsappChat, type WhatsappSessao } from "@/lib/queries/whatsapp";
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
};

export function ConversaCabecalho(p: Props) {
  const { chat, grupo } = p;
  const { eu, tem } = useEu();
  const modulos = useModulos();
  const mobile = useIsMobile();
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
      className="grid size-9 max-sm:size-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label="Mais ações"
    >
      <MoreVertical className="size-[18px]" />
    </button>
  );

  const chip = comAtendimento ? (
    <ResponsavelChip estado={estado} responsavel={acoes.responsavel} eu={eu} />
  ) : null;

  const botaoPrimario = principal ? (
    <Button
      onClick={principal.onClick}
      disabled={acoes.ocupado || !eu}
      className="max-sm:min-w-[9.5rem] max-sm:flex-1 md:h-9"
      title={principal.dica}
    >
      {acoes.ocupado ? <Loader2 className="animate-spin" /> : principal.icone}
      {principal.rotulo}
    </Button>
  ) : null;

  const chamado = chat ? (
    <SolicitacaoBotaoSeAtivo origem={{ chatRowId: chat.id, clienteId: chat.clienteId }} />
  ) : null;

  return (
    <header className="shrink-0 border-b bg-card shadow-[0_1px_3px_rgba(16,32,64,0.05)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.35)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-3 py-2.5 md:flex-nowrap md:px-4 md:py-3">
        <ConversaAvatar
          semente={chat?.chatId ?? p.nome}
          nome={chat?.nome}
          grupo={grupo}
          fotoPath={chat?.fotoPath}
        />

        <div className="min-w-0 flex-1 basis-[calc(100%-7rem)] md:basis-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="min-w-0 break-words text-[15px] font-semibold leading-tight tracking-[-0.01em] text-foreground md:text-base">
              {p.nome}
            </h2>
            {chat?.clienteId ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium leading-none text-primary">
                Cliente
              </span>
            ) : null}
            <TambemAqui outros={outros} />
          </div>
          <Sublinha chat={chat} sessao={p.sessao} numero={p.numero} nome={p.nome} grupo={grupo} />
        </div>

        {/* Desktop: tudo na mesma linha. Celular: o chip e a ação descem. */}
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          {chip}
          {botaoPrimario}
          {chamado}
          <Popover open={p.menuAberto && !mobile} onOpenChange={p.onMenuAbertoChange}>
            <PopoverTrigger asChild>{botaoMenu}</PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-1.5">
              {!mobile && menuItens}
            </PopoverContent>
          </Popover>
        </div>

        <div className="md:hidden">
          <button
            type="button"
            onClick={() => p.onMenuAbertoChange(true)}
            className="grid size-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Mais ações"
          >
            <MoreVertical className="size-5" />
          </button>
        </div>

        {(chip || botaoPrimario || chamado) && (
          <div className="flex w-full flex-wrap items-center gap-2 md:hidden">
            {chip}
            {botaoPrimario}
            {chamado && <div className="shrink-0 [&_button]:max-sm:h-11">{chamado}</div>}
          </div>
        )}
      </div>

      {mobile && (
        <Sheet open={p.menuAberto} onOpenChange={p.onMenuAbertoChange}>
          <SheetContent side="bottom" overlayClassName="md:hidden" className="md:hidden bg-card px-2 pb-3 pt-1">
            <SheetTitle className="sr-only">Ações da conversa</SheetTitle>
            <SheetDescription className="sr-only">Opções para esta conversa.</SheetDescription>
            {menuItens}
          </SheetContent>
        </Sheet>
      )}
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
          <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
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
// saída); "online" obsoleto um pouco depois. Aí cai pra "visto por último".
const PRESENCA_TYPING_TTL_MS = 18_000;
const PRESENCA_ONLINE_TTL_MS = 90_000;

function presencaTexto(chat: WhatsappChat | undefined): { texto: string; ativo: boolean } | null {
  if (!chat || chat.tipo !== "individual" || !chat.presenceEstado) return null;
  const em = chat.presenceEm ? parsePgTimestamp(chat.presenceEm)?.getTime() ?? 0 : 0;
  const idade = Date.now() - em;
  const est = chat.presenceEstado;
  if ((est === "typing" || est === "recording") && idade < PRESENCA_TYPING_TTL_MS) {
    return { texto: est === "recording" ? "gravando áudio…" : "digitando…", ativo: true };
  }
  if (est === "online" && idade < PRESENCA_ONLINE_TTL_MS) return { texto: "online", ativo: true };
  const visto = chat.ultimoVistoEm ? parsePgTimestamp(chat.ultimoVistoEm) : null;
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

  const pres = presencaTexto(chat);
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
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-50 max-sm:min-h-11",
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
      {!grupo && !p.mobile && (
        <Item
          icone={<PanelRight />}
          rotulo={p.painelAberto ? "Esconder painel do cliente" : "Painel do cliente"}
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
        <Item icone={<Trash2 />} rotulo="Apagar conversa" onClick={p.onApagar} disabled={p.apagando} perigo />
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
}: {
  /** Identificador do chat (JID). É a semente do desenho, NUNCA o nome. */
  semente: string;
  nome?: string | null;
  grupo: boolean;
  fotoPath?: string | null;
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
        "inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-medium md:size-11",
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
