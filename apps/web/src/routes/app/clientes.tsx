import { PageContainer } from "@/components/page-container";
import { Building2, ChevronRight, MapPin, Pencil, Plus, Search, SearchX, User, Users } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { AvatarIniciais } from "@/components/avatar-iniciais";
import { ABAS_CLIENTES, ModuloAbas } from "@/components/modulo-abas";
import { Tooltip } from "@/components/ui/tooltip";
import { CadastroIncompletoBadge } from "@/components/features/clientes/cadastro-incompleto-badge";
import { ImportarPlanilhaBotao } from "@/components/features/importar/importar-planilha-dialog";
import { Chips } from "@/components/ui/chips";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FiltrosResponsivos, type FiltroAtivo } from "@/components/ui/filtros-responsivos";
import { Input } from "@/components/ui/input";
import { ItemCard, ItemCardSkeleton, ListaResponsiva } from "@/components/ui/lista-responsiva";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QueryError } from "@/components/ui/query-error";
import { SkeletonTableRow } from "@/components/ui/skeleton";
import {
  SortableTableHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebounced } from "@/hooks/use-debounced";
import { usePageTitle } from "@/hooks/use-page-title";
import { useSort } from "@/hooks/use-sort";
import { formatDoc, formatTelefone } from "@/lib/format";
import { usePermissao } from "@/lib/colaborador";
import {
  nomeExibicao,
  useClientes,
  useContagemIncompletos,
  type ClienteResumo,
} from "@/lib/queries/clientes";
import { REGIMES, type RegimeTributario } from "@/lib/validations/cliente";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

const TODOS = "__todos__";

export function ClientesPage() {
  usePageTitle("Clientes");
  const podeEditar = usePermissao("clientes.editar");
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tipoParam = params.get("tipo") ?? "";
  const tipo = tipoParam === "PF" || tipoParam === "PJ" ? tipoParam : "";
  const regime = (params.get("regime") ?? "") as RegimeTributario | "";
  const situacaoParam = params.get("situacao");
  const situacao =
    situacaoParam === "inativos" || situacaoParam === "todos" ? situacaoParam : "ativos";
  const incompletos = params.get("cadastro") === "incompletos";
  const { data: totalIncompletos = 0 } = useContagemIncompletos();

  // Busca com debounce, mas refletida na URL (link compartilhável).
  const [busca, setBusca] = useState(params.get("q") ?? "");
  const q = useDebounced(busca, 200);
  useEffect(() => {
    setParam("q", q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function setParam(chave: string, valor: string) {
    setParams(
      (curr) => {
        const next = new URLSearchParams(curr);
        if (valor) next.set(chave, valor);
        else next.delete(chave);
        return next;
      },
      { replace: true },
    );
  }

  const { data: clientes = [], isLoading, isError, error, refetch, isPlaceholderData } = useClientes({ q, tipo, regime, situacao, incompletos });
  const filtrando = !!q || !!tipo || !!regime || situacao !== "ativos" || incompletos;
  // Chips do celular (a busca fica sempre à vista, fora da folha).
  const ativos: FiltroAtivo[] = [];
  if (tipo) ativos.push({ id: "tipo", rotulo: tipo === "PJ" ? "Empresas (PJ)" : "Pessoas (PF)", onRemover: () => setParam("tipo", "") });
  if (regime) ativos.push({ id: "regime", rotulo: regime, onRemover: () => setParam("regime", "") });
  if (situacao !== "ativos")
    ativos.push({ id: "situacao", rotulo: situacao === "inativos" ? "Inativos" : "Ativos e inativos", onRemover: () => setParam("situacao", "") });
  function limparFiltros() {
    setParams(
      (curr) => {
        const next = new URLSearchParams(curr);
        ["tipo", "regime", "situacao"].forEach((k) => next.delete(k));
        return next;
      },
      { replace: true },
    );
  }

  const acessores = useMemo(
    () => ({
      nome: (c: ClienteResumo) => nomeExibicao(c),
      tipo: (c: ClienteResumo) => c.tipo,
      regime: (c: ClienteResumo) => c.regimeTributario,
      cidade: (c: ClienteResumo) => c.cidade,
    }),
    [],
  );
  const { rows, sort, toggle } = useSort(clientes, acessores);

  return (
    <PageContainer>
      <PageHeader
        icon={Users}
        title="Clientes"
        description="Empresas e pessoas atendidas pelo escritório."
        actions={
          podeEditar ? (
            <div className="flex flex-wrap gap-2">
            <ImportarPlanilhaBotao alvo="clientes" />
            <Button asChild>
              <Link to="/clientes/novo">
                <Plus />
                Novo cliente
              </Link>
            </Button>
            </div>
          ) : undefined
        }
      />

      <ModuloAbas abas={ABAS_CLIENTES} />

      <FiltrosResponsivos
        className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center"
        ativos={ativos}
        onLimpar={limparFiltros}
        antes={
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente"
            aria-label="Buscar cliente por nome, CPF/CNPJ, e-mail ou telefone"
            className="pl-8 text-base fino:text-sm"
          />
        </div>
        }
      >
        <div className="grid grid-cols-1 gap-2 min-[440px]:grid-cols-3 sm:flex">
          <Select value={tipo || TODOS} onValueChange={(v) => setParam("tipo", v === TODOS ? "" : v)}>
            <SelectTrigger className="sm:w-[150px] sm:shrink-0" aria-label="Tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>PF e PJ</SelectItem>
              <SelectItem value="PJ">Empresas (PJ)</SelectItem>
              <SelectItem value="PF">Pessoas (PF)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={regime || TODOS} onValueChange={(v) => setParam("regime", v === TODOS ? "" : v)}>
            <SelectTrigger className="sm:w-[200px] sm:shrink-0" aria-label="Regime">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todo regime</SelectItem>
              {REGIMES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={situacao} onValueChange={(v) => setParam("situacao", v === "ativos" ? "" : v)}>
            <SelectTrigger className="sm:w-[130px] sm:shrink-0" aria-label="Situação">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ativos">Ativos</SelectItem>
              <SelectItem value="inativos">Inativos</SelectItem>
              <SelectItem value="todos">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FiltrosResponsivos>

      {(totalIncompletos > 0 || incompletos) && (
        <Chips
          rotulo="Cadastro"
          valor={incompletos ? "incompletos" : "todos"}
          onChange={(v) => setParam("cadastro", v === "incompletos" ? "incompletos" : "")}
          opcoes={[
            { valor: "todos", rotulo: "Todos" },
            { valor: "incompletos", rotulo: `Incompletos (${totalIncompletos})` },
          ]}
        />
      )}

      {isLoading ? (
        <ListaResponsiva
          corte="xl"
          tabela={
            <Table>
              <TableBody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonTableRow key={i} cols={5} />
                ))}
              </TableBody>
            </Table>
          }
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <ItemCardSkeleton key={i} />
          ))}
        </ListaResponsiva>
      ) : isError && clientes.length === 0 ? (
        <QueryError oque="os clientes" error={error} onRetry={refetch} />
      ) : clientes.length === 0 ? (
        filtrando ? (
          <EmptyState
            icon={SearchX}
            title="Nenhum cliente encontrado"
            description="Ajuste a busca ou os filtros."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setBusca("");
                  setParams(new URLSearchParams(), { replace: true });
                }}
              >
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Users}
            title="Nenhum cliente cadastrado"
            description="Cadastre as empresas e pessoas que o escritório atende. O telefone liga o cliente às conversas do WhatsApp."
            action={
              podeEditar ? (
                <Button asChild>
                  <Link to="/clientes/novo">
                    <Plus />
                    Cadastrar cliente
                  </Link>
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <ListaResponsiva
          corte="xl"
          // Lista anterior fica na tela (esmaecida) enquanto a busca nova chega.
          className={cn("transition-opacity duration-150", isPlaceholderData && "opacity-60")}
          tabela={
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableTableHead active={sort?.key === "nome"} dir={sort?.dir} onSort={() => toggle("nome")}>
                    Nome
                  </SortableTableHead>
                  <SortableTableHead active={sort?.key === "tipo"} dir={sort?.dir} onSort={() => toggle("tipo")}>
                    Tipo
                  </SortableTableHead>
                  <SortableTableHead active={sort?.key === "regime"} dir={sort?.dir} onSort={() => toggle("regime")}>
                    Regime
                  </SortableTableHead>
                  <TableHead>CPF / CNPJ</TableHead>
                  <TableHead>Contato</TableHead>
                  <SortableTableHead active={sort?.key === "cidade"} dir={sort?.dir} onSort={() => toggle("cidade")}>
                    Cidade
                  </SortableTableHead>
                  <TableHead className="w-20"><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow
                    key={c.id}
                    className="group cursor-pointer hover:bg-muted/40 [&>td]:py-3.5"
                    onClick={() => navigate(`/clientes/${c.id}`)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3 min-w-0">
                        <AvatarIniciais nome={nomeExibicao(c)} semente={c.id} empresa={c.tipo === "PJ"} size="md" />
                        <div className="min-w-0">
                          <span className="block truncate">{nomeExibicao(c)}</span>
                          {c.nomeFantasia && c.nomeFantasia !== c.nome && (
                            <span className="block truncate text-2xs text-muted-foreground font-normal">{c.nome}</span>
                          )}
                          {(!c.ativo || c.provisorio) && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {!c.ativo && <Badge variant="secondary">Inativo</Badge>}
                              {c.provisorio && <CadastroIncompletoBadge />}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <TipoBadge tipo={c.tipo} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.regimeTributario ?? "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground tabular-nums">{formatDoc(c.cpfCnpj)}</TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-col leading-tight min-w-0">
                        {c.telefone ? <span className="tabular-nums">{formatTelefone(c.telefone)}</span> : null}
                        {c.email ? <span className="truncate text-xs text-muted-foreground">{c.email}</span> : null}
                        {!c.telefone && !c.email ? <span className="text-muted-foreground">-</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[c.cidade, c.estado].filter(Boolean).join(" / ") || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                        {podeEditar && (
                          <Tooltip label="Editar cliente">
                            <Button asChild size="icon" variant="ghost" className="size-8" onClick={(e) => e.stopPropagation()}>
                              <Link to={`/clientes/${c.id}/editar`} aria-label="Editar cliente">
                                <Pencil className="size-4" />
                              </Link>
                            </Button>
                          </Tooltip>
                        )}
                        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
        >
          {rows.map((c) => (
            <ItemCard
              key={c.id}
              to={`/clientes/${c.id}`}
              titulo={
                <span className="flex items-center gap-2.5 min-w-0">
                  <AvatarIniciais nome={nomeExibicao(c)} semente={c.id} empresa={c.tipo === "PJ"} size="sm" />
                  <span className="truncate">{nomeExibicao(c)}</span>
                </span>
              }
              subtitulo={c.telefone ? formatTelefone(c.telefone) : c.email ?? undefined}
              selo={c.provisorio ? <CadastroIncompletoBadge /> : <TipoBadge tipo={c.tipo} />}
              meta={[
                c.cpfCnpj ? { texto: formatDoc(c.cpfCnpj) } : null,
                c.regimeTributario ? { texto: c.regimeTributario } : null,
                c.cidade ? { icone: MapPin, texto: [c.cidade, c.estado].filter(Boolean).join(" / ") } : null,
              ]}
            />
          ))}
        </ListaResponsiva>
      )}

      {clientes.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {clientes.length} {clientes.length === 1 ? "cliente" : "clientes"}
          {clientes.length >= 500 ? " (mostrando os 500 primeiros, refine a busca)" : ""}
        </p>
      )}
    </PageContainer>
  );
}

export function TipoBadge({ tipo }: { tipo: "PF" | "PJ" }) {
  return (
    <Badge variant={tipo === "PJ" ? "secondary" : "outline"} className="text-xs gap-1">
      {tipo === "PJ" ? <Building2 className="size-3" /> : <User className="size-3" />}
      {tipo}
    </Badge>
  );
}
