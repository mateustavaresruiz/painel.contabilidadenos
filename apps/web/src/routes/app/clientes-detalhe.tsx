import { PageContainer } from "@/components/page-container";
import {
  BadgeCheck,
  ChevronLeft,
  ClipboardList,
  ClipboardPlus,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { AvatarIniciais } from "@/components/avatar-iniciais";
import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { MarcaDagua } from "@/components/marca-hexagono";
import { FAIXA_TOPO } from "@/components/page-header";
import { corModulo } from "@/lib/cores-modulo";
import { cn } from "@/lib/utils";
import { CertificadoDialog } from "@/components/features/certificados/certificado-dialog";
import { CertificadoStatusBadge } from "@/components/features/certificados/certificado-status";
import { AnotarCliente } from "@/components/features/clientes/anotar-cliente";
import { CadastroIncompletoBadge } from "@/components/features/clientes/cadastro-incompleto-badge";
import { DeleteClienteButton } from "@/components/features/clientes/delete-cliente-button";
import { PortalClienteAba } from "@/components/features/clientes/portal-cliente";
import { ConversarWhatsappBotao } from "@/components/features/clientes/whatsapp-cliente";
import { ResumoFiscalCliente } from "@/components/features/serpro/serpro-painel";
import { ConsultarSituacaoBotao, ConsultasFiscaisLista } from "@/components/features/serpro/serpro-ui";
import {
  NovaSolicitacaoDialog,
  StatusSolicitacaoSelect,
  useTrocarStatusChamado,
} from "@/components/features/solicitacoes/solicitacao-ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { confirmar } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { QueryError } from "@/components/ui/query-error";
import { DetalheSkeleton, ListaSkeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAlgumaPermissao, useColaboradores, usePermissao } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { formatData, formatDataHora, formatDoc, formatTelefone, linkWaMe } from "@/lib/format";
import { isValidCpf, isValidTelefone, maskCpf, maskTelefone } from "@/lib/masks";
import { optionalEmail } from "@/lib/validations/cliente";
import { useModulos } from "@/lib/modulos";
import { useCertificados, useExcluirCertificado, type Certificado } from "@/lib/queries/certificados";
import {
  nomeExibicao,
  useCliente,
  useExcluirSocio,
  useSalvarSocio,
  useSocios,
  type Cliente,
  type Socio,
} from "@/lib/queries/clientes";
import { useSolicitacoes } from "@/lib/queries/solicitacoes";
import { supabase } from "@/lib/supabase";
import { toast } from "@/lib/toast";

import { HistoricoLista } from "@/components/features/auditoria/linha-do-tempo";

import { TipoBadge } from "./clientes";

const ABAS = ["dados", "socios", "certificados", "solicitacoes", "conversas", "fiscal", "portal", "historico"] as const;
type Aba = (typeof ABAS)[number];

export function ClienteDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const { data: cliente, isLoading, error, refetch } = useCliente(id);
  const podeEditar = usePermissao("clientes.editar");
  const podeExcluir = usePermissao("clientes.excluir");
  const { ativo: moduloAtivo } = useModulos();
  const mostraPortal = usePermissao("portal.gerenciar") && moduloAtivo("portalCliente");
  const mostraFiscal = usePermissao("serpro.consultar");
  const mostraCertificados = usePermissao("certificados.ver") && moduloAtivo("certificados");
  // Mesma regra do menu e da rota de Chamados: quem só abre chamado também vê os seus.
  const mostraChamados = useAlgumaPermissao(["chamados.ver", "chamados.criar", "chamados.gerenciar"]) && moduloAtivo("chamados");
  const podeAbrirChamado = usePermissao("chamados.criar") && moduloAtivo("chamados");
  const [novoChamado, setNovoChamado] = useState(false);
  const [params, setParams] = useSearchParams();
  const abaParam = params.get("aba") as Aba | null;
  const abaVisivel = (a: Aba) =>
    (a !== "portal" || mostraPortal) &&
    (a !== "fiscal" || mostraFiscal) &&
    (a !== "certificados" || mostraCertificados) &&
    (a !== "solicitacoes" || mostraChamados);
  const aba: Aba = abaParam && ABAS.includes(abaParam) && abaVisivel(abaParam) ? abaParam : "dados";
  usePageTitle(cliente ? nomeExibicao(cliente) : "Cliente");

  if (!id) return <Navigate to="/clientes" replace />;
  if (isLoading) return <DetalheSkeleton />;
  if (error) {
    return (
      <PageContainer>
        <QueryError oque="o cliente" error={error} onRetry={refetch} />
      </PageContainer>
    );
  }
  if (!cliente) {
    return (
      <PageContainer className="space-y-3">
        <p className="text-sm text-muted-foreground">Cliente não encontrado.</p>
        <Link to="/clientes" className="text-sm underline">
          Voltar para Clientes
        </Link>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <header className={cn(FAIXA_TOPO, "space-y-3")} style={corModulo("clientes")}>
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,transparent_55%,color-mix(in_srgb,var(--mc)_7%,transparent))]" />
        <MarcaDagua />
        <Link to="/clientes" className="relative inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground max-lg:-my-2.5 max-lg:py-2.5">
          <ChevronLeft className="size-4" />
          Clientes
        </Link>
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
          <AvatarIniciais nome={nomeExibicao(cliente)} semente={cliente.id} empresa={cliente.tipo === "PJ"} size="xl" className="rounded-xl" />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[22px] font-bold leading-tight tracking-[-0.015em] sm:text-[28px]">{nomeExibicao(cliente)}</h1>
              <TipoBadge tipo={cliente.tipo} />
              {cliente.regimeTributario && <Badge variant="outline">{cliente.regimeTributario}</Badge>}
              {!cliente.ativo && <Badge variant="secondary">Inativo</Badge>}
              {cliente.provisorio && <CadastroIncompletoBadge />}
            </div>
            <p className="text-sm text-muted-foreground">
              {[
                cliente.nomeFantasia && cliente.nomeFantasia !== cliente.nome ? cliente.nome : null,
                cliente.cpfCnpj ? formatDoc(cliente.cpfCnpj) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ConversarWhatsappBotao clienteId={cliente.id} telefone={cliente.telefone} />
            {podeAbrirChamado && (
              <Button variant="outline" onClick={() => setNovoChamado(true)}>
                <ClipboardPlus />
                Abrir chamado
              </Button>
            )}
            {podeEditar && cliente.provisorio && (
              <Link to={`/clientes/${cliente.id}/editar`} className={buttonVariants()}>
                <UserCheck />
                Completar cadastro
              </Link>
            )}
            {podeEditar && !cliente.provisorio && (
              <Link to={`/clientes/${cliente.id}/editar`} className={buttonVariants({ variant: "outline" })}>
                <Pencil />
                Editar
              </Link>
            )}
            {podeExcluir && <DeleteClienteButton clienteId={cliente.id} clienteNome={nomeExibicao(cliente)} />}
          </div>
        </div>
      </header>
      {podeAbrirChamado && (
        <NovaSolicitacaoDialog open={novoChamado} onOpenChange={setNovoChamado} origem={{ clienteId: cliente.id }} />
      )}

      <Tabs
        value={aba}
        onValueChange={(v) =>
          setParams(
            (c) => {
              const n = new URLSearchParams(c);
              if (v === "dados") n.delete("aba");
              else n.set("aba", v);
              return n;
            },
            { replace: true },
          )
        }
      >
        <div>
          <TabsList>
            <TabsTrigger value="dados">Dados</TabsTrigger>
            {cliente.tipo === "PJ" && <TabsTrigger value="socios">Sócios</TabsTrigger>}
            {mostraCertificados && <TabsTrigger value="certificados">Certificados</TabsTrigger>}
            {mostraChamados && <TabsTrigger value="solicitacoes">Chamados</TabsTrigger>}
            <TabsTrigger value="conversas">Conversas</TabsTrigger>
            {mostraFiscal && <TabsTrigger value="fiscal">Pendências fiscais</TabsTrigger>}
            {mostraPortal && <TabsTrigger value="portal">Portal do cliente</TabsTrigger>}
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="dados" className="mt-5">
          <DadosAba cliente={cliente} />
        </TabsContent>
        <TabsContent value="socios" className="mt-5">
          <SociosAba clienteId={cliente.id} />
        </TabsContent>
        {mostraCertificados && (
          <TabsContent value="certificados" className="mt-5">
            <CertificadosAba clienteId={cliente.id} />
          </TabsContent>
        )}
        {mostraChamados && (
          <TabsContent value="solicitacoes" className="mt-5">
            <SolicitacoesAba clienteId={cliente.id} />
          </TabsContent>
        )}
        <TabsContent value="conversas" className="mt-5">
          <ConversasAba clienteId={cliente.id} telefone={cliente.telefone} />
        </TabsContent>
        {mostraPortal && (
          <TabsContent value="portal" className="mt-5">
            <PortalClienteAba clienteId={cliente.id} nome={nomeExibicao(cliente)} telefone={cliente.telefone} />
          </TabsContent>
        )}
        <TabsContent value="historico" className="mt-5">
          <p className="mb-3 text-sm text-muted-foreground">
            Anotações da equipe, edições do cadastro, chamados, certificados, consultas fiscais e conversas deste cliente, do mais novo para o mais antigo.
          </p>
          <div className="max-w-3xl space-y-3 rounded-card border bg-card p-4">
            <AnotarCliente clienteId={cliente.id} />
            <HistoricoLista
              entidade="cliente"
              id={cliente.id}
              className="border-t pt-3"
              vazio="Ainda não há eventos deste cliente. Anotações, edições, chamados, certificados e consultas passam a aparecer aqui."
            />
          </div>
        </TabsContent>
        {mostraFiscal && (
        <TabsContent value="fiscal" className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Situação fiscal pelo Integra Contador (Serpro). Exige procuração do cliente no e-CAC.
            </p>
            <ConsultarSituacaoBotao clienteId={cliente.id} />
          </div>
          <ResumoFiscalCliente clienteId={cliente.id} />
          <ConsultasFiscaisLista clienteId={cliente.id} />
        </TabsContent>
        )}
      </Tabs>
    </PageContainer>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2 text-sm border-b last:border-0">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 break-words">{children || "-"}</dd>
    </div>
  );
}

function DadosAba({ cliente }: { cliente: Cliente }) {
  const wa = linkWaMe(cliente.telefone);
  const endereco = [
    [cliente.rua, cliente.numero].filter(Boolean).join(", "),
    cliente.complemento,
    cliente.bairro,
    [cliente.cidade, cliente.estado].filter(Boolean).join(" / "),
    cliente.cep,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="p-5">
          <h2 className="eyebrow mb-2">Cadastro</h2>
          <dl>
            <Linha rotulo={cliente.tipo === "PJ" ? "Razão social" : "Nome"}>{cliente.nome}</Linha>
            {cliente.tipo === "PJ" && <Linha rotulo="Nome fantasia">{cliente.nomeFantasia}</Linha>}
            <Linha rotulo={cliente.tipo === "PJ" ? "CNPJ" : "CPF"}>{formatDoc(cliente.cpfCnpj)}</Linha>
            {cliente.tipo === "PJ" ? (
              <Linha rotulo="Abertura">{cliente.dataAbertura ? formatData(cliente.dataAbertura) : null}</Linha>
            ) : (
              <Linha rotulo="Nascimento">{cliente.dataNascimento ? formatData(cliente.dataNascimento) : null}</Linha>
            )}
            <Linha rotulo="Regime">{cliente.regimeTributario}</Linha>
            <Linha rotulo="Insc. estadual">{cliente.inscricaoEstadual}</Linha>
            <Linha rotulo="Insc. municipal">{cliente.inscricaoMunicipal}</Linha>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <h2 className="eyebrow mb-2">Contato e endereço</h2>
          <dl>
            <Linha rotulo="Telefone">
              {cliente.telefone ? (
                <span className="inline-flex items-center gap-2">
                  {formatTelefone(cliente.telefone)}
                  {wa && (
                    <a href={wa} target="_blank" rel="noreferrer" className="text-xs text-primary underline max-lg:py-3">
                      wa.me
                    </a>
                  )}
                </span>
              ) : null}
            </Linha>
            <Linha rotulo="E-mail">{cliente.email}</Linha>
            <Linha rotulo="Endereço">{endereco}</Linha>
            <Linha rotulo="Cadastrado em">{formatDataHora(cliente.criadoEm)}</Linha>
          </dl>
          {cliente.observacoes && (
            <div className="mt-4">
              <h3 className="eyebrow mb-1">Observações</h3>
              <p className="text-sm whitespace-pre-wrap">{cliente.observacoes}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sócios
// ---------------------------------------------------------------------------

function SociosAba({ clienteId }: { clienteId: string }) {
  const { data: socios = [], isLoading, isError, error, refetch } = useSocios(clienteId);
  const excluir = useExcluirSocio(clienteId);
  const podeEditar = usePermissao("clientes.editar");
  const [editando, setEditando] = useState<Socio | null | "novo">(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          A data de nascimento entra nos Aniversários (filtro "Só sócios").
        </p>
        {podeEditar && (
          <Button size="sm" onClick={() => setEditando("novo")}>
            <Plus />
            Sócio
          </Button>
        )}
      </div>
      {isLoading ? (
        <ListaSkeleton linhas={3} />
      ) : isError && socios.length === 0 ? (
        <QueryError oque="os sócios" error={error} onRetry={refetch} />
      ) : socios.length === 0 ? (
        <p className="rounded-card border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          <Users className="size-5 mx-auto mb-2 opacity-60" />
          Nenhum sócio cadastrado.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {socios.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {s.nome}
                  {s.administrador && <Badge variant="outline" className="ml-2">Administrador</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    s.cpf ? formatDoc(s.cpf) : null,
                    s.participacao != null ? `${s.participacao}%` : null,
                    s.dataNascimento ? `nasc. ${formatData(s.dataNascimento)}` : null,
                    s.telefone ? formatTelefone(s.telefone) : null,
                    s.email,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "-"}
                </p>
              </div>
              {podeEditar && (
                <>
                  <Button size="icon" variant="ghost" onClick={() => setEditando(s)} aria-label={`Editar sócio ${s.nome}`}>
                    <Pencil />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Excluir sócio ${s.nome}`}
                    onClick={async () => {
                      if (!(await confirmar({ titulo: `Excluir ${s.nome}?`, confirmLabel: "Excluir", destructive: true }))) return;
                      excluir.mutate(s.id, { onError: (e) => toast.error(msgErro(e)) });
                    }}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {podeEditar && (
        <SocioDialog
          clienteId={clienteId}
          socio={editando === "novo" ? null : editando}
          open={editando !== null}
          onOpenChange={(o) => !o && setEditando(null)}
        />
      )}
    </div>
  );
}

function CampoErro({ msg }: { msg?: string | null }) {
  return msg ? (
    <p role="alert" className="text-xs text-destructive">
      {msg}
    </p>
  ) : null;
}

function SocioDialog({
  clienteId,
  socio,
  open,
  onOpenChange,
}: {
  clienteId: string;
  socio: Socio | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const salvar = useSalvarSocio(clienteId);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [nasc, setNasc] = useState("");
  const [tel, setTel] = useState("");
  const [email, setEmail] = useState("");
  const [part, setPart] = useState("");
  const [adm, setAdm] = useState(false);
  const [iniciado, setIniciado] = useState<string | null>(null);
  const [tentou, setTentou] = useState(false);
  const [erroNasc, setErroNasc] = useState<string | null>(null);

  // Preenche ao abrir (chave = id do sócio ou "novo").
  const chave = open ? (socio?.id ?? "novo") : null;
  if (chave !== iniciado) {
    setIniciado(chave);
    if (chave) {
      setNome(socio?.nome ?? "");
      setCpf(socio?.cpf ? maskCpf(socio.cpf) : "");
      setNasc(socio?.dataNascimento ?? "");
      setTel(socio?.telefone ? maskTelefone(socio.telefone) : "");
      setEmail(socio?.email ?? "");
      setPart(socio?.participacao != null ? String(socio.participacao) : "");
      setAdm(socio?.administrador ?? false);
      setTentou(false);
      setErroNasc(null);
    }
  }

  const p = part.trim() ? Number(part.replace(",", ".")) : null;
  const erros = {
    nome: nome.trim().length < 2 ? "Informe o nome do sócio." : null,
    cpf: cpf && !isValidCpf(cpf) ? "CPF inválido." : null,
    tel: tel && !isValidTelefone(tel) ? "Telefone incompleto (DDD + número)." : null,
    email: email.trim() && !optionalEmail.safeParse(email).success ? "E-mail inválido." : null,
    part: p != null && (!Number.isFinite(p) || p < 0 || p > 100) ? "A participação vai de 0 a 100." : null,
    nasc: erroNasc,
  };
  const temErro = Object.values(erros).some(Boolean);
  const ver = (k: keyof typeof erros) => (tentou ? erros[k] : null);

  async function enviar() {
    setTentou(true);
    if (temErro) return;
    try {
      await salvar.mutateAsync({
        id: socio?.id,
        input: {
          nome: nome.trim(),
          cpf: cpf || null,
          dataNascimento: nasc || null,
          telefone: tel || null,
          email: email.trim() || null,
          participacao: p,
          administrador: adm,
        },
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  const inv = (k: keyof typeof erros) => (ver(k) ? "border-destructive" : undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{socio ? "Editar sócio" : "Novo sócio"}</DialogTitle>
          <DialogDescription>Quadro societário da empresa.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="so-nome">Nome *</Label>
            <Input id="so-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus aria-invalid={!!ver("nome") || undefined} className={inv("nome")} />
            <CampoErro msg={ver("nome")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="so-cpf">CPF</Label>
            <Input id="so-cpf" inputMode="numeric" value={cpf} onChange={(e) => setCpf(maskCpf(e.target.value))} aria-invalid={!!ver("cpf") || undefined} className={inv("cpf")} />
            <CampoErro msg={ver("cpf")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="so-nasc">Data de nascimento</Label>
            <DatePicker id="so-nasc" limpavel value={nasc} onChange={setNasc} onErroChange={setErroNasc} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="so-tel">Telefone</Label>
            <Input id="so-tel" inputMode="tel" value={tel} onChange={(e) => setTel(maskTelefone(e.target.value))} aria-invalid={!!ver("tel") || undefined} className={inv("tel")} />
            <CampoErro msg={ver("tel")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="so-part">Participação (%)</Label>
            <Input id="so-part" inputMode="decimal" value={part} onChange={(e) => setPart(e.target.value)} aria-invalid={!!ver("part") || undefined} className={inv("part")} />
            <CampoErro msg={ver("part")} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="so-email">E-mail</Label>
            <Input id="so-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!ver("email") || undefined} className={inv("email")} />
            <CampoErro msg={ver("email")} />
          </div>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={adm} onChange={(e) => setAdm(e.target.checked)} className="size-4 accent-[var(--primary)]" />
            Sócio administrador
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Certificados
// ---------------------------------------------------------------------------

function CertificadosAba({ clienteId }: { clienteId: string }) {
  const { data = [], isLoading, isError, error, refetch } = useCertificados({ clienteId });
  const excluir = useExcluirCertificado();
  const podeEditar = usePermissao("certificados.editar");
  const [editando, setEditando] = useState<Certificado | null | "novo">(null);
  return (
    <div className="space-y-3">
      {podeEditar && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setEditando("novo")}>
            <Plus />
            Certificado
          </Button>
        </div>
      )}
      {isLoading ? (
        <ListaSkeleton linhas={3} />
      ) : isError && data.length === 0 ? (
        <QueryError oque="os certificados" error={error} onRetry={refetch} />
      ) : data.length === 0 ? (
        <p className="rounded-card border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          <BadgeCheck className="size-5 mx-auto mb-2 opacity-60" />
          Nenhum certificado cadastrado.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {data.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {c.tipo}
                  {c.titular ? <span className="text-muted-foreground font-normal"> · {c.titular}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  Válido até {formatData(c.validoAte)}
                  {c.emissora ? ` · ${c.emissora}` : ""}
                  {c.avisarWhatsapp ? " · aviso no WhatsApp" : " · sem aviso"}
                </p>
              </div>
              <CertificadoStatusBadge validoAte={c.validoAte} />
              {podeEditar && (
                <>
                  <Button size="icon" variant="ghost" onClick={() => setEditando(c)} aria-label={`Editar certificado ${c.tipo}`}>
                    <Pencil />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Excluir certificado ${c.tipo}`}
                    onClick={async () => {
                      if (!(await confirmar({ titulo: "Excluir certificado?", confirmLabel: "Excluir", destructive: true }))) return;
                      excluir.mutate(c.id, { onError: (e) => toast.error(msgErro(e)) });
                    }}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {podeEditar && (
        <CertificadoDialog
          open={editando !== null}
          onOpenChange={(o) => !o && setEditando(null)}
          certificado={editando === "novo" ? null : editando}
          clienteIdFixo={clienteId}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chamados e conversas
// ---------------------------------------------------------------------------

function SolicitacoesAba({ clienteId }: { clienteId: string }) {
  const { data = [], isLoading, isError, error, refetch } = useSolicitacoes({ clienteId });
  const { trocar } = useTrocarStatusChamado();
  const { data: colabs = [] } = useColaboradores();
  const mapa = new Map(colabs.map((c) => [c.id, c]));
  const podeCriar = usePermissao("chamados.criar");
  const [nova, setNova] = useState(false);
  return (
    <div className="space-y-3">
      {podeCriar && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setNova(true)}>
            <Plus />
            Chamado
          </Button>
        </div>
      )}
      {isLoading ? (
        <ListaSkeleton linhas={3} />
      ) : isError && data.length === 0 ? (
        <QueryError oque="os chamados" error={error} onRetry={refetch} />
      ) : data.length === 0 ? (
        <p className="rounded-card border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          <ClipboardList className="size-5 mx-auto mb-2 opacity-60" />
          Nenhum chamado deste cliente.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {data.map((s) => {
            const resp = s.responsavelId ? mapa.get(s.responsavelId) : undefined;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-[200px]">
                  <p className="text-sm font-medium">{s.tipo?.nome}</p>
                  {s.descricao && <p className="text-xs text-muted-foreground line-clamp-2">{s.descricao}</p>}
                  <p className="text-2xs text-muted-foreground">
                    {formatDataHora(s.criadoEm)}
                    {s.prazo ? ` · prazo ${formatData(s.prazo)}` : ""}
                  </p>
                </div>
                {resp && <ColaboradorAvatar nome={resp.nome} cor={resp.cor} size="xs" />}
                <StatusSolicitacaoSelect
                  value={s.status}
                  onChange={(status) => trocar(s.id, s.status, status)}
                />
              </li>
            );
          })}
        </ul>
      )}
      {podeCriar && <NovaSolicitacaoDialog open={nova} onOpenChange={setNova} origem={{ clienteId }} />}
    </div>
  );
}

function ConversasAba({ clienteId, telefone }: { clienteId: string; telefone: string | null }) {
  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["conversas-do-cliente", clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("WhatsappChat")
        .select("id, sessaoId, chatId, nome, ultimaMensagemTexto, ultimaMensagemEm, atendimentoStatus, responsavelId")
        .eq("clienteId", clienteId)
        .is("apagadoEm", null)
        .order("ultimaMensagemEm", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        sessaoId: string;
        chatId: string;
        nome: string | null;
        ultimaMensagemTexto: string | null;
        ultimaMensagemEm: string | null;
        atendimentoStatus: string;
        responsavelId: string | null;
      }>;
    },
  });
  const { data: colabs = [] } = useColaboradores();
  const mapa = new Map(colabs.map((c) => [c.id, c]));
  if (isLoading) return <ListaSkeleton linhas={3} />;
  if (isError && data.length === 0) return <QueryError oque="as conversas" error={error} onRetry={refetch} />;
  if (data.length === 0) {
    return (
      <p className="rounded-card border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        <MessageSquare className="size-5 mx-auto mb-2 opacity-60" />
        Nenhuma conversa vinculada.{" "}
        {telefone ? "As conversas do WhatsApp deste cliente aparecem aqui depois de vinculadas." : "Cadastre o telefone para facilitar o vínculo."}
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {data.map((c) => {
        const resp = c.responsavelId ? mapa.get(c.responsavelId) : undefined;
        return (
          <li key={c.id}>
            <Link
              to={`/whatsapp?instancia=${encodeURIComponent(c.sessaoId)}&chat=${encodeURIComponent(c.chatId)}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40"
            >
              <MessageSquare className="size-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{c.nome ?? formatTelefone(c.chatId.replace(/@.*/, ""))}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {c.ultimaMensagemEm ? formatDataHora(c.ultimaMensagemEm) + " · " : ""}
                  {c.ultimaMensagemTexto ?? "Sem mensagens"}
                </p>
              </div>
              {resp && <ColaboradorAvatar nome={resp.nome} cor={resp.cor} size="xs" />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

