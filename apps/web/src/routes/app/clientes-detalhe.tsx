import {
  BadgeCheck,
  ChevronLeft,
  ClipboardList,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { CertificadoDialog } from "@/components/features/certificados/certificado-dialog";
import { CertificadoStatusBadge } from "@/components/features/certificados/certificado-status";
import { DeleteClienteButton } from "@/components/features/clientes/delete-cliente-button";
import { ConsultarSituacaoBotao, ConsultasFiscaisLista } from "@/components/features/serpro/serpro-ui";
import {
  NovaSolicitacaoDialog,
  StatusSolicitacaoSelect,
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
import { Label } from "@/components/ui/label";
import { DetalheSkeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageTitle } from "@/hooks/use-page-title";
import { useColaboradoresMap, usePermissao } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { formatData, formatDataHora, formatDoc, formatTelefone, linkWaMe } from "@/lib/format";
import { maskCpfCnpj, maskTelefone } from "@/lib/masks";
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
import { useAtualizarSolicitacao, useSolicitacoes } from "@/lib/queries/solicitacoes";
import { supabase } from "@/lib/supabase";
import { toast } from "@/lib/toast";

import { TipoBadge } from "./clientes";

const ABAS = ["dados", "socios", "certificados", "solicitacoes", "conversas", "fiscal"] as const;
type Aba = (typeof ABAS)[number];

export function ClienteDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const { data: cliente, isLoading, error } = useCliente(id);
  const podeEditar = usePermissao("clientes.editar");
  const podeExcluir = usePermissao("clientes.excluir");
  const [params, setParams] = useSearchParams();
  const abaParam = params.get("aba") as Aba | null;
  const aba: Aba = abaParam && ABAS.includes(abaParam) ? abaParam : "dados";
  usePageTitle(cliente ? nomeExibicao(cliente) : "Cliente");

  if (!id) return <Navigate to="/clientes" replace />;
  if (isLoading) return <DetalheSkeleton />;
  if (error) {
    return <div className="p-8 text-sm text-destructive">Erro ao carregar: {msgErro(error)}</div>;
  }
  if (!cliente) {
    return (
      <div className="p-8 space-y-3">
        <p className="text-sm text-muted-foreground">Cliente não encontrado.</p>
        <Link to="/clientes" className="text-sm underline">
          Voltar para Clientes
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <header className="space-y-3">
        <Link to="/clientes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" />
          Clientes
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-title-lg truncate">{nomeExibicao(cliente)}</h1>
              <TipoBadge tipo={cliente.tipo} />
              {cliente.regimeTributario && <Badge variant="outline">{cliente.regimeTributario}</Badge>}
              {!cliente.ativo && <Badge variant="secondary">Inativo</Badge>}
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
          <div className="flex flex-wrap gap-2">
            {podeEditar && (
              <Link to={`/clientes/${cliente.id}/editar`} className={buttonVariants({ variant: "outline" })}>
                <Pencil />
                Editar
              </Link>
            )}
            {podeExcluir && <DeleteClienteButton clienteId={cliente.id} clienteNome={nomeExibicao(cliente)} />}
          </div>
        </div>
      </header>

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
        <div className="overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList>
            <TabsTrigger value="dados">Dados</TabsTrigger>
            {cliente.tipo === "PJ" && <TabsTrigger value="socios">Sócios</TabsTrigger>}
            <TabsTrigger value="certificados">Certificados</TabsTrigger>
            <TabsTrigger value="solicitacoes">Chamados</TabsTrigger>
            <TabsTrigger value="conversas">Conversas</TabsTrigger>
            <TabsTrigger value="fiscal">Consultas fiscais</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="dados" className="mt-5">
          <DadosAba cliente={cliente} />
        </TabsContent>
        <TabsContent value="socios" className="mt-5">
          <SociosAba clienteId={cliente.id} />
        </TabsContent>
        <TabsContent value="certificados" className="mt-5">
          <CertificadosAba clienteId={cliente.id} />
        </TabsContent>
        <TabsContent value="solicitacoes" className="mt-5">
          <SolicitacoesAba clienteId={cliente.id} />
        </TabsContent>
        <TabsContent value="conversas" className="mt-5">
          <ConversasAba clienteId={cliente.id} telefone={cliente.telefone} />
        </TabsContent>
        <TabsContent value="fiscal" className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Situação fiscal pelo Integra Contador (Serpro). Exige procuração do cliente no e-CAC.
            </p>
            <ConsultarSituacaoBotao clienteId={cliente.id} />
          </div>
          <ConsultasFiscaisLista clienteId={cliente.id} />
        </TabsContent>
      </Tabs>
    </div>
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
    <div className="grid gap-4 lg:grid-cols-2">
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
                    <a href={wa} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
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
  const { data: socios = [], isLoading } = useSocios(clienteId);
  const excluir = useExcluirSocio(clienteId);
  const [editando, setEditando] = useState<Socio | null | "novo">(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          A data de nascimento entra nos Aniversários (aba "Sócios").
        </p>
        <Button size="sm" onClick={() => setEditando("novo")}>
          <Plus />
          Sócio
        </Button>
      </div>
      {isLoading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : socios.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
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
              <Button size="icon" variant="ghost" onClick={() => setEditando(s)} aria-label="Editar sócio">
                <Pencil />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Excluir sócio"
                onClick={async () => {
                  if (!(await confirmar({ titulo: `Excluir ${s.nome}?`, confirmLabel: "Excluir", destructive: true }))) return;
                  excluir.mutate(s.id, { onError: (e) => toast.error(msgErro(e)) });
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <SocioDialog
        clienteId={clienteId}
        socio={editando === "novo" ? null : editando}
        open={editando !== null}
        onOpenChange={(o) => !o && setEditando(null)}
      />
    </div>
  );
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

  // Preenche ao abrir (chave = id do sócio ou "novo").
  const chave = open ? (socio?.id ?? "novo") : null;
  if (chave !== iniciado) {
    setIniciado(chave);
    if (chave) {
      setNome(socio?.nome ?? "");
      setCpf(socio?.cpf ? maskCpfCnpj(socio.cpf) : "");
      setNasc(socio?.dataNascimento ?? "");
      setTel(socio?.telefone ? maskTelefone(socio.telefone) : "");
      setEmail(socio?.email ?? "");
      setPart(socio?.participacao != null ? String(socio.participacao) : "");
      setAdm(socio?.administrador ?? false);
    }
  }

  async function enviar() {
    if (nome.trim().length < 2) return toast.error("Informe o nome do sócio.");
    const p = part.trim() ? Number(part.replace(",", ".")) : null;
    if (p != null && (!Number.isFinite(p) || p < 0 || p > 100)) return toast.error("Participação entre 0 e 100.");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{socio ? "Editar sócio" : "Novo sócio"}</DialogTitle>
          <DialogDescription>Quadro societário da empresa.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="so-nome">Nome *</Label>
            <Input id="so-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="so-cpf">CPF</Label>
            <Input id="so-cpf" inputMode="numeric" value={cpf} onChange={(e) => setCpf(maskCpfCnpj(e.target.value).slice(0, 14))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="so-nasc">Data de nascimento</Label>
            <Input id="so-nasc" type="date" value={nasc} onChange={(e) => setNasc(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="so-tel">Telefone</Label>
            <Input id="so-tel" inputMode="tel" value={tel} onChange={(e) => setTel(maskTelefone(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="so-part">Participação (%)</Label>
            <Input id="so-part" inputMode="decimal" value={part} onChange={(e) => setPart(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="so-email">E-mail</Label>
            <Input id="so-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
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
  const { data = [], isLoading } = useCertificados({ clienteId });
  const excluir = useExcluirCertificado();
  const [editando, setEditando] = useState<Certificado | null | "novo">(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditando("novo")}>
          <Plus />
          Certificado
        </Button>
      </div>
      {isLoading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : data.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
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
              <Button size="icon" variant="ghost" onClick={() => setEditando(c)} aria-label="Editar">
                <Pencil />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Excluir"
                onClick={async () => {
                  if (!(await confirmar({ titulo: "Excluir certificado?", confirmLabel: "Excluir", destructive: true }))) return;
                  excluir.mutate(c.id, { onError: (e) => toast.error(msgErro(e)) });
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <CertificadoDialog
        open={editando !== null}
        onOpenChange={(o) => !o && setEditando(null)}
        certificado={editando === "novo" ? null : editando}
        clienteIdFixo={clienteId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chamados e conversas
// ---------------------------------------------------------------------------

function SolicitacoesAba({ clienteId }: { clienteId: string }) {
  const { data = [], isLoading } = useSolicitacoes({ clienteId });
  const atualizar = useAtualizarSolicitacao();
  const mapa = useColaboradoresMap();
  const [nova, setNova] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setNova(true)}>
          <Plus />
          Chamado
        </Button>
      </div>
      {isLoading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : data.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
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
                  onChange={(status) => atualizar.mutate({ id: s.id, patch: { status } }, { onError: (e) => toast.error(msgErro(e)) })}
                />
              </li>
            );
          })}
        </ul>
      )}
      <NovaSolicitacaoDialog open={nova} onOpenChange={setNova} origem={{ clienteId }} />
    </div>
  );
}

function ConversasAba({ clienteId, telefone }: { clienteId: string; telefone: string | null }) {
  const { data = [], isLoading } = useQuery({
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
  const mapa = useColaboradoresMap();
  if (isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (data.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        <MessageSquare className="size-5 mx-auto mb-2 opacity-60" />
        Nenhuma conversa vinculada.{" "}
        {telefone ? "Quando o contato escrever, vincule a conversa pelo painel lateral do Atendimento." : "Cadastre o telefone para facilitar o vínculo."}
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

