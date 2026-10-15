import {
  Copy,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { ColaboradorForm } from "@/components/colaborador-form";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { confirmar } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { usePageTitle } from "@/hooks/use-page-title";
import { useColaboradores, useEu, usePermissao, type Cargo, type Colaborador } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { formatTelefone } from "@/lib/format";
import { CATALOGO_PERMISSOES, TODAS_PERMISSOES } from "@/lib/permissoes";
import {
  useAtualizarPessoa,
  useCargos,
  useEmailStatus,
  useEnviarAcesso,
  useExcluirCargo,
  useExcluirPessoa,
  useGerarLinkAcesso,
  useSalvarCargo,
  type ResultadoConvite,
} from "@/lib/queries/equipe";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function EquipePage() {
  usePageTitle("Equipe");
  const gerenciar = usePermissao("equipe.gerenciar");
  const [params, setParams] = useSearchParams();
  const aba = params.get("tab") === "cargos" ? "cargos" : "pessoas";
  const [convidando, setConvidando] = useState(false);
  const [novoCargo, setNovoCargo] = useState(false);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        icon={UsersRound}
        title="Equipe"
        description="Quem entra no painel e o que cada cargo pode fazer."
        actions={
          gerenciar ? (
            aba === "pessoas" ? (
              <Button onClick={() => setConvidando(true)}>
                <UserPlus />
                Convidar
              </Button>
            ) : (
              <Button onClick={() => setNovoCargo(true)}>
                <Plus />
                Novo cargo
              </Button>
            )
          ) : undefined
        }
      />
      <Tabs
        value={aba}
        onValueChange={(v) => {
          const p = new URLSearchParams(params);
          if (v === "pessoas") p.delete("tab");
          else p.set("tab", v);
          setParams(p, { replace: true });
        }}
      >
        <TabsList>
          <TabsTrigger value="pessoas">Pessoas</TabsTrigger>
          <TabsTrigger value="cargos">Cargos</TabsTrigger>
        </TabsList>
        <TabsContent value="pessoas" className="mt-5">
          <AbaPessoas gerenciar={gerenciar} convidando={convidando} setConvidando={setConvidando} />
        </TabsContent>
        <TabsContent value="cargos" className="mt-5">
          <AbaCargos gerenciar={gerenciar} novo={novoCargo} setNovo={setNovoCargo} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pessoas
// ---------------------------------------------------------------------------

function AbaPessoas({
  gerenciar,
  convidando,
  setConvidando,
}: {
  gerenciar: boolean;
  convidando: boolean;
  setConvidando: (v: boolean) => void;
}) {
  const { data = [], isLoading, error } = useColaboradores();
  const { euId } = useEu();
  const excluir = useExcluirPessoa();
  const atualizar = useAtualizarPessoa();
  const gerarLink = useGerarLinkAcesso();
  const enviarAcesso = useEnviarAcesso();
  const { data: email } = useEmailStatus(gerenciar);
  const [editando, setEditando] = useState<Colaborador | null>(null);
  const [link, setLink] = useState<{ nome: string; link: string; aviso?: string } | null>(null);

  async function remover(c: Colaborador) {
    const ok = await confirmar({
      titulo: `Excluir ${c.nome}?`,
      descricao:
        "O acesso dele é apagado. As conversas e chamados ficam sem responsável e as mensagens enviadas perdem o autor. Para só tirar o acesso, desative em vez de excluir.",
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    excluir.mutate(c.id, { onError: (e) => toast.error(msgErro(e)) });
  }

  async function alternarAtivo(c: Colaborador) {
    if (c.ativo) {
      const ok = await confirmar({
        titulo: `Desativar ${c.nome}?`,
        descricao: "O login fica bloqueado na hora e as sessões abertas são encerradas. Dá para reativar depois.",
        confirmLabel: "Desativar",
        destructive: true,
      });
      if (!ok) return;
    }
    atualizar.mutate(
      { id: c.id, patch: { ativo: !c.ativo } },
      {
        onSuccess: () => toast.success(c.ativo ? `${c.nome} desativado.` : `${c.nome} reativado.`),
        onError: (e) => toast.error(msgErro(e)),
      },
    );
  }

  async function linkDeAcesso(c: Colaborador) {
    const ok = await confirmar({
      titulo: `Gerar link de acesso para ${c.nome}?`,
      descricao:
        "O link entra no painel sem senha, funciona uma vez e expira em 15 minutos. Gerar um link novo invalida o último link ou código enviado por e-mail.",
      confirmLabel: "Gerar link",
    });
    if (!ok) return;
    gerarLink.mutate(c.id, {
      onSuccess: (r) => setLink({ nome: c.nome, link: r.link }),
      onError: (e) => toast.error(msgErro(e)),
    });
  }

  function aposConvite(r: ResultadoConvite) {
    setConvidando(false);
    if (r.emailEnviado) {
      toast.success(`Convite enviado para ${r.colaborador.email}.`);
    } else if (r.link) {
      setLink({
        nome: r.colaborador.nome,
        link: r.link,
        aviso: r.erroEmail
          ? `O e-mail não foi enviado (${r.erroEmail}). Mande este link por outro meio.`
          : "O e-mail do painel ainda não está configurado. Mande este link por outro meio (WhatsApp, por exemplo).",
      });
    }
  }

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-card" />
        ))}
      </div>
    );
  }
  if (error) return <p className="text-sm text-destructive">Não foi possível carregar a equipe: {msgErro(error)}</p>;

  return (
    <>
      {data.length === 0 ? (
        <EmptyState icon={UsersRound} title="Ninguém na equipe" description="Use Convidar para liberar o acesso de alguém." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => (
            <li key={c.id} className={cn("rounded-card border bg-card flex flex-col transition-opacity", !c.ativo && "opacity-60")}>
              <div className="flex items-start gap-3 p-5 pb-4">
                <ColaboradorAvatar nome={c.nome} cor={c.cor} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold truncate">{c.nome}</span>
                    {c.id === euId && <Badge variant="secondary">você</Badge>}
                    {!c.ativo && <Badge variant="outline">inativo</Badge>}
                  </p>
                  {c.cargo && <p className="text-xs text-muted-foreground">{c.cargo}</p>}
                  {c.email && (
                    <p className="mt-1 text-2xs text-muted-foreground flex items-center gap-1.5 min-w-0">
                      <Mail className="size-3 shrink-0" />
                      <span className="truncate" title={c.email}>{c.email}</span>
                    </p>
                  )}
                  {c.telefone && (
                    <p className="text-2xs text-muted-foreground flex items-center gap-1.5">
                      <Phone className="size-3 shrink-0" />
                      {formatTelefone(c.telefone)}
                    </p>
                  )}
                </div>
                {gerenciar && (
                  <div className="flex items-center gap-0.5 -mr-2 -mt-1.5 shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => setEditando(c)} aria-label="Editar" title="Editar">
                      <Pencil />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => void remover(c)}
                      disabled={c.id === euId}
                      title={c.id === euId ? "Você não pode excluir a si mesmo" : "Excluir"}
                      aria-label="Excluir"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </div>
              {gerenciar && (
                <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-divider px-3 py-2">
                  {c.ativo && c.email && (
                    <Button size="sm" variant="ghost" onClick={() => void linkDeAcesso(c)} disabled={gerarLink.isPending}>
                      <Link2 />
                      Gerar link de acesso
                    </Button>
                  )}
                  {c.ativo && c.email && email?.configurado && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={enviarAcesso.isPending && enviarAcesso.variables === c.id}
                      disabled={enviarAcesso.isPending}
                      onClick={() =>
                        enviarAcesso.mutate(c.id, {
                          onSuccess: () => toast.success(`Acesso enviado para ${c.email}.`),
                          onError: (e) => toast.error(msgErro(e)),
                        })
                      }
                    >
                      <Mail />
                      Enviar acesso
                    </Button>
                  )}
                  {c.id !== euId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className={cn("ml-auto", c.ativo && "text-destructive hover:bg-destructive/5")}
                      onClick={() => void alternarAtivo(c)}
                      loading={atualizar.isPending && atualizar.variables?.id === c.id}
                      disabled={atualizar.isPending}
                    >
                      {c.ativo ? "Desativar" : "Reativar"}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={convidando || editando !== null} onOpenChange={(o) => !o && (setConvidando(false), setEditando(null))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar pessoa da equipe" : "Convidar para a equipe"}</DialogTitle>
            <DialogDescription>
              {editando
                ? "Trocar o e-mail muda também o login. O cargo define o que a pessoa pode fazer."
                : "A pessoa entra com este e-mail, sem senha. Não há cadastro público: só entra quem for convidado aqui."}
            </DialogDescription>
          </DialogHeader>
          {(convidando || editando) && (
            <ColaboradorForm
              key={editando?.id ?? "novo"}
              inicial={editando}
              onSalvo={() => setEditando(null)}
              onConvidado={aposConvite}
              onCancelar={() => {
                setConvidando(false);
                setEditando(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <LinkAcessoDialog dados={link} onClose={() => setLink(null)} />
    </>
  );
}

function LinkAcessoDialog({
  dados,
  onClose,
}: {
  dados: { nome: string; link: string; aviso?: string } | null;
  onClose: () => void;
}) {
  async function copiar() {
    if (!dados) return;
    try {
      await navigator.clipboard.writeText(dados.link);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não deu para copiar. Selecione o link e copie à mão.");
    }
  }
  return (
    <Dialog open={!!dados} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link de acesso de {dados?.nome}</DialogTitle>
          <DialogDescription>
            Funciona uma vez e expira em 15 minutos. Quem abrir o link entra como {dados?.nome}: mande só para a
            própria pessoa.
          </DialogDescription>
        </DialogHeader>
        {dados?.aviso && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{dados.aviso}</p>}
        <Input readOnly value={dados?.link ?? ""} onFocus={(e) => e.currentTarget.select()} className="text-xs" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={() => void copiar()}>
            <Copy />
            Copiar link de acesso
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Cargos
// ---------------------------------------------------------------------------

function AbaCargos({ gerenciar, novo, setNovo }: { gerenciar: boolean; novo: boolean; setNovo: (v: boolean) => void }) {
  const { data: cargos = [], isLoading, error } = useCargos();
  const { data: pessoas = [] } = useColaboradores();
  const excluir = useExcluirCargo();
  const [editando, setEditando] = useState<Cargo | null>(null);

  const porCargo = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pessoas) m.set(p.cargoId, (m.get(p.cargoId) ?? 0) + 1);
    return m;
  }, [pessoas]);

  async function remover(c: Cargo) {
    const ok = await confirmar({
      titulo: `Apagar o cargo ${c.nome}?`,
      descricao: "O cargo some da lista. Esta ação não pode ser desfeita.",
      confirmLabel: "Apagar",
      destructive: true,
    });
    if (!ok) return;
    excluir.mutate(c.id, { onError: (e) => toast.error(msgErro(e)) });
  }

  if (isLoading) return <Skeleton className="h-40 rounded-card" />;
  if (error) return <p className="text-sm text-destructive">Não foi possível carregar os cargos: {msgErro(error)}</p>;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cargos.map((c) => {
          const qtd = porCargo.get(c.id) ?? 0;
          const total = c.sistema ? TODAS_PERMISSOES.length : c.permissoes.length;
          return (
            <Card key={c.id}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold flex items-center gap-1.5">
                      {c.sistema && <ShieldCheck className="size-4 text-primary" />}
                      {c.nome}
                    </p>
                    {c.descricao && <p className="text-xs text-muted-foreground mt-0.5">{c.descricao}</p>}
                  </div>
                  {gerenciar && !c.sistema && (
                    <div className="flex gap-0.5">
                      <Button size="icon" variant="ghost" onClick={() => setEditando(c)} aria-label="Editar cargo">
                        <Pencil />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => void remover(c)}
                        disabled={qtd > 0}
                        title={qtd > 0 ? "Mova as pessoas deste cargo para outro antes de apagar" : "Apagar cargo"}
                        aria-label="Apagar cargo"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 text-2xs text-muted-foreground">
                  <span>
                    {qtd} {qtd === 1 ? "pessoa" : "pessoas"}
                  </span>
                  <span>·</span>
                  <span>{c.sistema ? "todas as permissões" : `${total} de ${TODAS_PERMISSOES.length} permissões`}</span>
                </div>
                {!c.sistema && (
                  <Button size="sm" variant="secondary" onClick={() => setEditando(c)}>
                    <KeyRound />
                    {gerenciar ? "Permissões" : "Ver permissões"}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <CargoDialog
        aberto={novo || editando !== null}
        cargo={editando}
        somenteLeitura={!gerenciar}
        onClose={() => {
          setNovo(false);
          setEditando(null);
        }}
      />
    </>
  );
}

function CargoDialog({
  aberto,
  cargo,
  somenteLeitura,
  onClose,
}: {
  aberto: boolean;
  cargo: Cargo | null;
  somenteLeitura: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{cargo ? `Cargo ${cargo.nome}` : "Novo cargo"}</DialogTitle>
          <DialogDescription>
            Marque o que quem tem este cargo pode fazer. Vale na hora para todas as pessoas do cargo.
          </DialogDescription>
        </DialogHeader>
        {aberto && <CargoForm key={cargo?.id ?? "novo"} cargo={cargo} somenteLeitura={somenteLeitura} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function CargoForm({ cargo, somenteLeitura, onClose }: { cargo: Cargo | null; somenteLeitura: boolean; onClose: () => void }) {
  const salvar = useSalvarCargo();
  const [nome, setNome] = useState(cargo?.nome ?? "");
  const [descricao, setDescricao] = useState(cargo?.descricao ?? "");
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set(cargo?.permissoes ?? []));

  function alternar(chaves: string[], ligar: boolean) {
    setMarcadas((atual) => {
      const n = new Set(atual);
      for (const c of chaves) {
        if (ligar) n.add(c);
        else n.delete(c);
      }
      return n;
    });
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (nome.trim().length < 2) return toast.error("Informe o nome do cargo.");
    try {
      await salvar.mutateAsync({
        id: cargo?.id,
        input: { nome, descricao, permissoes: TODAS_PERMISSOES.filter((p) => marcadas.has(p)) },
      });
      toast.success("Cargo salvo.");
      onClose();
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cargo-nome">Nome</Label>
          <Input id="cargo-nome" value={nome} onChange={(e) => setNome(e.target.value)} disabled={somenteLeitura} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cargo-desc">Descrição</Label>
          <Textarea
            id="cargo-desc"
            rows={2}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            disabled={somenteLeitura}
          />
        </div>
      </div>
      <div className="space-y-4">
        {CATALOGO_PERMISSOES.map((g) => {
          const chaves = g.permissoes.map((p) => p.chave);
          const n = chaves.filter((c) => marcadas.has(c)).length;
          return (
            <fieldset key={g.modulo} className="rounded-card border">
              <legend className="sr-only">{g.modulo}</legend>
              <label className="flex items-center gap-3 px-4 py-3 border-b bg-muted/40 rounded-t-card">
                <Checkbox
                  checked={n === chaves.length}
                  indeterminate={n > 0 && n < chaves.length}
                  onChange={(e) => alternar(chaves, e.target.checked)}
                  disabled={somenteLeitura}
                  aria-label={`Marcar tudo de ${g.modulo}`}
                />
                <span className="text-sm font-semibold flex-1">{g.modulo}</span>
                <span className="text-2xs text-muted-foreground">
                  {n} de {chaves.length}
                </span>
              </label>
              <div className="divide-y divide-divider">
                {g.permissoes.map((p) => (
                  <label key={p.chave} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="pt-0.5">
                      <Checkbox
                        checked={marcadas.has(p.chave)}
                        onChange={(e) => alternar([p.chave], e.target.checked)}
                        disabled={somenteLeitura}
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm">{p.rotulo}</span>
                      <span className="block text-2xs text-muted-foreground">{p.descricao}</span>
                    </span>
                  </label>
                ))}
              </div>
              {g.modulo === "Equipe" && (
                <p className="border-t px-4 py-2.5 text-2xs text-warning bg-warning/5 rounded-b-card">
                  As permissões de Equipe são para administradores: quem tem estas permissões vê
                  e-mails e cargos de todos e pode convidar ou desativar pessoas. Para transferir
                  conversas e atribuir chamados ninguém precisa delas.
                </p>
              )}
            </fieldset>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {somenteLeitura ? "Fechar" : "Cancelar"}
        </Button>
        {!somenteLeitura && (
          <Button type="submit" disabled={salvar.isPending}>
            {salvar.isPending && <Loader2 className="animate-spin" />}
            Salvar cargo
          </Button>
        )}
      </div>
    </form>
  );
}
