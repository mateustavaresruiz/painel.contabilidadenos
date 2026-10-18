import { formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowRight, Bot, ChevronDown, History, Loader2, MessageSquareQuote } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useColaboradoresMap, useEu } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { parsePgTimestamp } from "@/lib/format";
import {
  formatarValor,
  MODULO_LABEL,
  ORIGEM_LABEL,
  temDetalhes,
  useHistorico,
  type AuditoriaEvento,
  type EntidadeHistorico,
} from "@/lib/queries/auditoria";
import { cn } from "@/lib/utils";

/** "há 5 minutos"; o horário exato fica no title (passar o mouse). */
export function TempoRelativo({ iso, className }: { iso: string; className?: string }) {
  const d = parsePgTimestamp(iso);
  if (!d) return null;
  const seg = (Date.now() - d.getTime()) / 1000;
  const texto = seg < 45 ? "agora mesmo" : formatDistanceToNowStrict(d, { locale: ptBR, addSuffix: true });
  const exato = d.toLocaleString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <time dateTime={d.toISOString()} title={exato} className={className}>
      {texto}
    </time>
  );
}

function rotuloDia(d: Date): string {
  if (isToday(d)) return "Hoje";
  if (isYesterday(d)) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/** Avatar de quem agiu; sem pessoa = o sistema. */
function AtorAvatar({ ev }: { ev: AuditoriaEvento }) {
  const mapa = useColaboradoresMap();
  const c = ev.atorId ? mapa.get(ev.atorId) : undefined;
  if (ev.atorId || ev.atorNome) {
    return <ColaboradorAvatar nome={ev.atorNome ?? c?.nome} cor={c?.cor} size="sm" />;
  }
  return (
    <span
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      title="Sistema"
      aria-label="Sistema"
    >
      <Bot className="size-4" />
    </span>
  );
}

/** Antes → depois, campos e comentário: nada de JSON cru. */
function Detalhes({ ev }: { ev: AuditoriaEvento }) {
  const d = ev.detalhes;
  if (!d) return null;
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border/70 bg-muted/30 p-2.5 text-xs">
      {d.alteracoes?.map((a, i) => (
        <div key={`${a.campo}-${i}`} className="space-y-1">
          <p className="font-medium text-foreground">{a.rotulo}</p>
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <span className="max-w-full break-words rounded bg-destructive/10 px-1.5 py-0.5 text-destructive line-through decoration-destructive/40">
              {formatarValor(a.de)}
            </span>
            <ArrowRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-label="para" />
            <span className="max-w-full break-words rounded bg-success/10 px-1.5 py-0.5 text-success">
              {formatarValor(a.para)}
            </span>
          </div>
        </div>
      ))}
      {d.info && d.info.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {d.info.map((i, k) => (
            <div key={`${i.rotulo}-${k}`} className="contents">
              <dt className="text-muted-foreground">{i.rotulo}</dt>
              <dd className="min-w-0 break-words text-foreground">{i.valor}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * Caminho do perfil de quem agiu, se quem está vendo pode abrir (auditoria.ver
 * vê todos; os demais, só o próprio). O banco confere de novo (migration 016).
 */
export function usePerfilDoAtor(atorId: string | null | undefined): string | null {
  const { euId, tem } = useEu();
  if (!atorId) return null;
  return tem("auditoria.ver") || atorId === euId ? `/equipe/${atorId}` : null;
}

/** Uma linha do histórico: quem, o quê, quando e (expandindo) o antes/depois. */
export function EventoItem({
  ev,
  mostrarModulo = false,
  semLinkAtor = false,
  className,
}: {
  ev: AuditoriaEvento;
  mostrarModulo?: boolean;
  /** Já está no perfil da pessoa: o nome não vira link. */
  semLinkAtor?: boolean;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const perfil = usePerfilDoAtor(ev.atorId);
  const linkPerfil = semLinkAtor ? null : perfil;
  const comentario = ev.acao === "comentario" && !!ev.detalhes?.texto;
  const expansivel = temDetalhes(ev.detalhes);
  const ator = ev.atorNome ?? (ev.modulo === "portal" ? "Cliente (portal)" : "Sistema");
  const automatica = ev.origem !== "painel" && !ev.atorNome;

  return (
    <li className={cn("flex gap-3 py-3", className)}>
      {linkPerfil ? (
        <Link to={linkPerfil} className="h-fit shrink-0 rounded-full" aria-label={`Perfil de ${ator}`} tabIndex={-1}>
          <AtorAvatar ev={ev} />
        </Link>
      ) : (
        <AtorAvatar ev={ev} />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug [text-wrap:pretty]">
          {linkPerfil ? (
            <Link to={linkPerfil} className="font-semibold hover:text-primary hover:underline" title={`Abrir o perfil de ${ator}`}>
              {ator}
            </Link>
          ) : (
            <span className="font-semibold">{ator}</span>
          )}{" "}
          {ev.resumo}
        </p>
        {comentario && (
          <div className="mt-1.5 flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-sm">
            <MessageSquareQuote className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <p className="min-w-0 whitespace-pre-wrap break-words">{ev.detalhes!.texto}</p>
          </div>
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <TempoRelativo iso={ev.criadoEm} />
          {mostrarModulo && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
              {MODULO_LABEL[ev.modulo] ?? ev.modulo}
            </span>
          )}
          {automatica && <span>· {ORIGEM_LABEL[ev.origem]}</span>}
          {expansivel && (
            <button
              type="button"
              onClick={() => setAberto((v) => !v)}
              aria-expanded={aberto}
              className="relative inline-flex items-center gap-0.5 rounded text-primary hover:underline toque:after:absolute toque:after:-inset-x-2 toque:after:-inset-y-3.5 toque:after:content-['']"
            >
              {aberto ? "Ocultar detalhes" : "Ver detalhes"}
              <ChevronDown className={cn("size-3 transition-transform", aberto && "rotate-180")} />
            </button>
          )}
        </p>
        {aberto && expansivel && <Detalhes ev={ev} />}
      </div>
    </li>
  );
}

/** Agrupa por dia (Hoje, Ontem, 12 de outubro) mantendo a ordem. */
export function EventosPorDia({
  eventos,
  mostrarModulo,
  semLinkAtor,
}: {
  eventos: AuditoriaEvento[];
  mostrarModulo?: boolean;
  semLinkAtor?: boolean;
}) {
  const grupos: { dia: string; itens: AuditoriaEvento[] }[] = [];
  for (const ev of eventos) {
    const d = parsePgTimestamp(ev.criadoEm);
    const dia = d ? rotuloDia(d) : "";
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.itens.push(ev);
    else grupos.push({ dia, itens: [ev] });
  }
  return (
    <div>
      {grupos.map((g) => (
        <section key={`${g.dia}-${g.itens[0]!.id}`} aria-label={g.dia}>
          <h4 className="mt-1 inline-block rounded-md bg-muted/60 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.dia}
          </h4>
          <ul className="divide-y divide-border/60">
            {g.itens.map((ev) => (
              <EventoItem key={ev.id} ev={ev} mostrarModulo={mostrarModulo} semLinkAtor={semLinkAtor} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Linha do tempo de um chamado, uma conversa ou um cliente. */
export function HistoricoLista({
  entidade,
  id,
  vazio = "Ainda não há nada registrado aqui.",
  className,
}: {
  entidade: EntidadeHistorico;
  id: string;
  vazio?: string;
  className?: string;
}) {
  const q = useHistorico(entidade, id);
  const eventos = q.data?.pages.flat() ?? [];

  if (q.isLoading) {
    return (
      <div className={cn("space-y-4", className)} aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (q.isError) {
    return (
      <p className={cn("rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive", className)}>
        Não deu para carregar o histórico. {msgErro(q.error)}
      </p>
    );
  }
  if (eventos.length === 0) {
    return (
      <div className={cn("flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground", className)}>
        <span className="grid size-10 place-items-center rounded-full bg-muted">
          <History className="size-5" aria-hidden />
        </span>
        <p className="max-w-xs [text-wrap:pretty]">{vazio}</p>
      </div>
    );
  }
  return (
    <div className={className}>
      <EventosPorDia eventos={eventos} />
      {q.hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage && <Loader2 className="animate-spin" />}
            Ver eventos mais antigos
          </Button>
        </div>
      )}
    </div>
  );
}
