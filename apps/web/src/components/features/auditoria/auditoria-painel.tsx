import { Download, Loader2, Search, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

import { EventosPorDia } from "@/components/features/auditoria/linha-do-tempo";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { QueryError } from "@/components/ui/query-error";
import { EmptyState } from "@/components/ui/empty-state";
import { FiltrosResponsivos, type FiltroAtivo } from "@/components/ui/filtros-responsivos";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounced } from "@/hooks/use-debounced";
import { useColaboradores } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { formatData } from "@/lib/format";
import {
  ACOES_AUDITORIA,
  exportarAuditoriaCsv,
  LIMITE_EXPORTACAO,
  MODULOS_AUDITORIA,
  PAGINA_FEED,
  useAuditoriaFeed,
  type FiltrosAuditoria,
} from "@/lib/queries/auditoria";
import { toast } from "@/lib/toast";

const TODOS = "__todos__";

/**
 * Configurações > Auditoria (permissão `auditoria.ver`): tudo o que aconteceu no
 * painel, do mais novo para o mais antigo, 50 por vez. Filtra por período,
 * pessoa, módulo, ação e texto; exporta em CSV o que está filtrado.
 */
export function AuditoriaPainel() {
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [atorId, setAtorId] = useState("");
  const [modulo, setModulo] = useState("");
  const [acao, setAcao] = useState("");
  const [busca, setBusca] = useState("");
  const [exportando, setExportando] = useState(false);
  const buscaDebounced = useDebounced(busca, 350);
  const { data: pessoas = [] } = useColaboradores();

  const filtros: FiltrosAuditoria = {
    de: de || undefined,
    ate: ate || undefined,
    atorId: atorId || undefined,
    modulo: modulo || undefined,
    acao: acao || undefined,
    busca: buscaDebounced || undefined,
  };
  const filtrando = !!(de || ate || atorId || modulo || acao || busca);
  // Chips do celular (a busca fica à vista, fora da folha).
  const ativos: FiltroAtivo[] = [];
  if (de) ativos.push({ id: "de", rotulo: `De ${formatData(de)}`, onRemover: () => setDe("") });
  if (ate) ativos.push({ id: "ate", rotulo: `Até ${formatData(ate)}`, onRemover: () => setAte("") });
  if (atorId)
    ativos.push({
      id: "ator",
      rotulo: atorId === "sistema" ? "Sistema" : pessoas.find((x) => x.id === atorId)?.nome ?? "Pessoa",
      onRemover: () => setAtorId(""),
    });
  if (modulo) ativos.push({ id: "modulo", rotulo: MODULOS_AUDITORIA.find((m) => m.valor === modulo)?.rotulo ?? modulo, onRemover: () => setModulo("") });
  if (acao) ativos.push({ id: "acao", rotulo: ACOES_AUDITORIA.find((a) => a.valor === acao)?.rotulo ?? acao, onRemover: () => setAcao("") });
  const q = useAuditoriaFeed(filtros);
  const eventos = q.data?.pages.flat() ?? [];

  function limpar() {
    setDe("");
    setAte("");
    setAtorId("");
    setModulo("");
    setAcao("");
    setBusca("");
  }

  async function exportar() {
    setExportando(true);
    try {
      const r = await exportarAuditoriaCsv(filtros);
      toast.success(
        r.cortado
          ? `Exportei os ${r.linhas.toLocaleString("pt-BR")} eventos mais recentes (limite de ${LIMITE_EXPORTACAO.toLocaleString("pt-BR")}). Restrinja o período para ver o resto.`
          : `${r.linhas.toLocaleString("pt-BR")} evento(s) exportado(s).`,
      );
    } catch (e) {
      toast.error(msgErro(e));
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="space-y-4">
      <FiltrosResponsivos
        className="space-y-3 rounded-card border bg-card p-3"
        ativos={ativos}
        onLimpar={limpar}
        antes={
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar no texto ou pelo nome de quem fez"
            className="pl-9"
            aria-label="Buscar na auditoria"
          />
        </div>
        }
        depois={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {q.isLoading
              ? "Carregando…"
              : `${eventos.length.toLocaleString("pt-BR")}${q.hasNextPage ? "+" : ""} evento(s) ${filtrando ? "com estes filtros" : "no histórico"}`}
          </p>
          <div className="flex items-center gap-2">
            {filtrando && (
              <Button variant="ghost" size="sm" onClick={limpar}>
                <X />
                Limpar filtros
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void exportar()} disabled={exportando || eventos.length === 0}>
              {exportando ? <Loader2 className="animate-spin" /> : <Download />}
              Exportar CSV
            </Button>
          </div>
        </div>
        }
      >
        <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 xl:grid-cols-5">
          <DatePicker value={de} onChange={setDe} limpavel placeholder="De" aria-label="A partir de" />
          <DatePicker value={ate} onChange={setAte} limpavel placeholder="Até" aria-label="Até" />
          <Select value={atorId || TODOS} onValueChange={(v) => setAtorId(v === TODOS ? "" : v)}>
            <SelectTrigger aria-label="Pessoa" className="min-[480px]:col-span-2 sm:col-span-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas as pessoas</SelectItem>
              <SelectItem value="sistema">Sistema (automático)</SelectItem>
              {pessoas.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nome}
                  {!p.ativo ? " (inativo)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={modulo || TODOS} onValueChange={(v) => setModulo(v === TODOS ? "" : v)}>
            <SelectTrigger aria-label="Módulo" className="min-[480px]:col-span-2 sm:col-span-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os módulos</SelectItem>
              {MODULOS_AUDITORIA.map((m) => (
                <SelectItem key={m.valor} value={m.valor}>
                  {m.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={acao || TODOS} onValueChange={(v) => setAcao(v === TODOS ? "" : v)}>
            <SelectTrigger aria-label="Ação" className="min-[480px]:col-span-2 sm:col-span-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value={TODOS}>Todas as ações</SelectItem>
              {ACOES_AUDITORIA.map((a) => (
                <SelectItem key={a.valor} value={a.valor}>
                  {a.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </FiltrosResponsivos>

      {q.isLoading ? (
        <div className="space-y-4 rounded-card border bg-card p-4" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </div>
      ) : q.isError ? (
        <QueryError oque="a auditoria" error={q.error} onRetry={q.refetch} />
      ) : eventos.length === 0 ? (
        filtrando ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nenhum evento com estes filtros"
            description="Troque o período, a pessoa ou o texto da busca."
            action={
              <Button variant="outline" onClick={limpar}>
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={ShieldCheck}
            title="Nada registrado ainda"
            description="Chamados, clientes, atendimento do WhatsApp, certificados, equipe e ajustes passam a aparecer aqui assim que alguém mexer."
          />
        )
      ) : (
        <div className="rounded-card border bg-card px-4 pb-4 pt-2">
          <EventosPorDia eventos={eventos} mostrarModulo />
          {q.hasNextPage && (
            <div className="flex justify-center pt-3">
              <Button variant="outline" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                {q.isFetchingNextPage && <Loader2 className="animate-spin" />}
                Carregar mais {PAGINA_FEED}
              </Button>
            </div>
          )}
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground [text-wrap:pretty]">
        O painel guarda todo o histórico, sem apagar nada por enquanto. Se um dia o volume pesar, dá para combinar uma
        limpeza por data (por exemplo, eventos com mais de dois anos). Mensagens do WhatsApp, "visto" e presença não entram
        aqui: seriam milhares de linhas por dia.
      </p>
    </div>
  );
}
