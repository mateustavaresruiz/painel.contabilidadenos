import { ArrowLeft, Loader2, Plus, Search, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebounced } from "@/hooks/use-debounced";
import {
  buscarClientesPorTelefone,
  nomeExibicao,
  useClientes,
  useCreateCliente,
} from "@/lib/queries/clientes";
import { msgErro } from "@/lib/erro";
import { iniciaisDeContato } from "@/lib/iniciais";
import { maskCpfCnpj, maskTelefone } from "@/lib/masks";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canal: "whatsapp" | "email";
  conversaId: string;
  sugestao: string | null;
  /** Nome do contato (pushName do WhatsApp) para pré-preencher o cadastro. */
  nomeSugerido?: string | null;
  onConfirmar: (clienteId: string) => Promise<void> | void;
};

/**
 * Dialog para vincular uma conversa (WhatsApp ou e-mail) a um cliente
 * cadastrado. Pré-preenche a busca com o número/e-mail da conversa
 * quando disponível para acelerar o match.
 */
type Modo = "buscar" | "criar";

export function VincularClienteDialog({
  open,
  onOpenChange,
  canal,
  sugestao,
  nomeSugerido,
  onConfirmar,
}: Props) {
  const [modo, setModo] = useState<Modo>("buscar");
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const buscaDebounced = useDebounced(busca, 200);
  const criar = useCreateCliente();

  // Pré-preenche com o número/e-mail quando o dialog abre.
  useEffect(() => {
    if (open) {
      const inicial = sugestao ? sugestaoBusca(sugestao, canal) : "";
      setBusca(inicial);
      setSelecionado(null);
      setModo("buscar");
    }
  }, [open, sugestao, canal]);

  const { data: clientes = [], isLoading } = useClientes({
    q: buscaDebounced,
  });

  const visiveis = useMemo(() => clientes.slice(0, 50), [clientes]);

  async function handleConfirmar() {
    if (!selecionado) return;
    setSalvando(true);
    try {
      await onConfirmar(selecionado);
    } finally {
      setSalvando(false);
    }
  }

  async function handleCriarEVincular(input: {
    tipo: "PF" | "PJ";
    nome: string;
    cpfCnpj?: string;
    email?: string;
    telefone?: string;
  }) {
    setSalvando(true);
    try {
      // Dedup por telefone: dois clientes com o mesmo número bugam o contexto
      // da conversa. Se já existe um com esse telefone, vincula a ELE em vez
      // de criar um duplicado — o que também torna o fluxo idempotente (clicar
      // "Criar" duas vezes não gera dois cadastros).
      if (input.telefone?.trim()) {
        // A RPC tolera o 9º dígito (o adv3 não tolerava, defeito 46).
        const [existente] = await buscarClientesPorTelefone(input.telefone);
        if (existente) {
          await onConfirmar(existente.id);
          toast.info(
            `Já existe um cliente com esse telefone (${existente.nome}). Vinculei a conversa a ele.`,
          );
          return;
        }
      }
      const cliente = await criar.mutateAsync({
        tipo: input.tipo,
        ativo: true,
        nome: input.nome.trim(),
        cpfCnpj: input.cpfCnpj?.trim() || undefined,
        email: input.email?.trim() || undefined,
        telefone: input.telefone?.trim() || undefined,
      });
      await onConfirmar(cliente.id);
      toast.success("Cliente criado e vinculado");
    } catch (err) {
      toast.error(msgErro(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {modo === "buscar" ? (
          <>
            <DialogHeader>
              <DialogTitle>Vincular cliente</DialogTitle>
              <DialogDescription>
                Escolha o cliente que corresponde a esta{" "}
                {canal === "whatsapp" ? "conversa" : "thread"}. O painel lateral
                passa a mostrar sócios, certificado e chamados dele.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  autoFocus
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome, CPF/CNPJ ou e-mail…"
                  className="pl-8"
                />
              </div>

              <div className="border rounded-md max-h-64 overflow-y-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                ) : visiveis.length === 0 ? (
                  <div className="py-6 px-3 text-center space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {busca.trim()
                        ? "Nenhum cliente encontrado com esses termos."
                        : "Comece a digitar para buscar um cliente."}
                    </p>
                    {busca.trim() && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setModo("criar")}
                      >
                        <Plus className="size-3.5 mr-1.5" />
                        Criar cliente novo
                      </Button>
                    )}
                  </div>
                ) : (
                  <ul>
                    {visiveis.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setSelecionado(c.id)}
                          className={cn(
                            "w-full text-left px-3 py-2 flex items-start gap-3 hover:bg-accent/50 transition-colors border-b border-border/40 last:border-b-0",
                            selecionado === c.id && "bg-accent",
                          )}
                        >
                          <span className="grid place-items-center size-8 rounded-full bg-primary/15 text-primary text-xs font-medium shrink-0">
                            {iniciaisDeContato(nomeExibicao(c)) ?? "?"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{nomeExibicao(c)}</p>
                            <p className="text-2xs text-muted-foreground truncate">
                              {[c.cpfCnpj, c.telefone, c.email]
                                .filter(Boolean)
                                .join(" · ") || c.tipo}
                            </p>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Atalho sempre visível para criar um novo direto */}
              <button
                type="button"
                onClick={() => setModo("criar")}
                className="w-full text-xs text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1.5 py-1"
              >
                <Plus className="size-3" />
                Não tá na lista? Criar cliente novo
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={salvando}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmar}
                disabled={!selecionado || salvando}
              >
                {salvando ? (
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                ) : (
                  <UserPlus className="size-3.5 mr-1.5" />
                )}
                Vincular
              </Button>
            </div>
          </>
        ) : (
          <CriarClienteForm
            canal={canal}
            sugestao={sugestao}
            sugestaoNome={busca.trim()}
            nomeSugerido={nomeSugerido ?? null}
            salvando={salvando}
            onCancelar={() => setModo("buscar")}
            onSubmit={handleCriarEVincular}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CriarClienteForm({
  canal,
  sugestao,
  sugestaoNome,
  nomeSugerido,
  salvando,
  onCancelar,
  onSubmit,
}: {
  canal: "whatsapp" | "email";
  sugestao: string | null;
  sugestaoNome: string;
  nomeSugerido: string | null;
  salvando: boolean;
  onCancelar: () => void;
  onSubmit: (input: {
    tipo: "PF" | "PJ";
    nome: string;
    cpfCnpj?: string;
    email?: string;
    telefone?: string;
  }) => Promise<void>;
}) {
  // Telefone do WhatsApp sempre no padrão internacional só-dígitos
  // (55 + DDD + número, ex.: 5511950218830) — sem máscara.
  const telSugerido =
    canal === "whatsapp" ? telefoneE164BR(sugestao) : "";
  const emailSugerido = canal === "email" && sugestao ? sugestao : "";
  // Nome puxado do WhatsApp (pushName) tem prioridade. Cai pro texto da
  // busca se não houver. Em ambos os casos, ignora valores que parecem
  // telefone/e-mail (não são nome de gente).
  const ehTelOuEmail = (s: string) =>
    /^[\d\s()\-+]+$/.test(s) || s.includes("@");
  const doWhats = (nomeSugerido ?? "").trim();
  const nomeInicial =
    doWhats && !ehTelOuEmail(doWhats)
      ? doWhats
      : ehTelOuEmail(sugestaoNome)
        ? ""
        : sugestaoNome;

  const [tipo, setTipo] = useState<"PF" | "PJ">("PF");
  const [nome, setNome] = useState(nomeInicial);
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [email, setEmail] = useState(emailSugerido);
  const [telefone, setTelefone] = useState(
    telSugerido ? maskTelefone(telSugerido.replace(/^55(?=\d{10,11}$)/, "")) : "",
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (nome.trim().length < 2) return;
    void onSubmit({ tipo, nome, cpfCnpj, email, telefone });
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="size-7 grid place-items-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
            aria-label="Voltar para a busca"
          >
            <ArrowLeft className="size-4" />
          </button>
          <DialogTitle>Criar e vincular cliente</DialogTitle>
        </div>
        <DialogDescription className="pl-9">
          Cadastro rápido. Você pode completar o resto depois em Clientes.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Tipo" htmlFor="c-tipo" required>
          <Select value={tipo} onValueChange={(v) => setTipo(v as "PF" | "PJ")}>
            <SelectTrigger id="c-tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PF">Pessoa física</SelectItem>
              <SelectItem value="PJ">Pessoa jurídica</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Nome" htmlFor="c-nome" required>
          <Input
            id="c-nome"
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={tipo === "PF" ? "Nome completo" : "Razão social"}
            required
            minLength={2}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label={tipo === "PF" ? "CPF" : "CNPJ"} htmlFor="c-doc">
            <Input
              id="c-doc"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={cpfCnpj}
              onChange={(e) => setCpfCnpj(maskCpfCnpj(e.target.value))}
            />
          </Field>
          <Field label="Telefone" htmlFor="c-tel">
            <Input
              id="c-tel"
              inputMode="tel"
              value={telefone}
              onChange={(e) => setTelefone(maskTelefone(e.target.value))}
            />
          </Field>
        </div>

        <Field label="E-mail" htmlFor="c-email">
          <Input
            id="c-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <div className="flex items-center justify-between gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancelar}
            disabled={salvando}
          >
            Voltar
          </Button>
          <Button type="submit" size="sm" disabled={salvando || nome.trim().length < 2}>
            {salvando ? (
              <Loader2 className="size-3.5 animate-spin mr-1.5" />
            ) : (
              <UserPlus className="size-3.5 mr-1.5" />
            )}
            Criar e vincular
          </Button>
        </div>
      </form>
    </>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
        {required ? <span className="text-destructive ml-0.5">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

/**
 * Converte um identificador da conversa em algo útil para busca:
 *   - número WhatsApp `5511950218830@c.us` → `(11) 95021-8830`
 *     (formato legível com DDD + número; o user pode editar/encurtar)
 *   - e-mail → o próprio endereço
 *
 * Antes retornava só os 9 últimos dígitos ("950218830"), mas:
 *   1. Cadastros usam formatos variados ("(11) 9...", "11 9...", etc)
 *      e match parcial casa com qualquer um quando vem DDD+número
 *   2. O user reclamou que "não vem inteiro"
 */
/**
 * Normaliza um número pro padrão BR só-dígitos com código do país:
 * 55 + DDD + número (ex.: 5511950218830). Sem máscara. Usado como valor
 * padrão do campo telefone ao criar cliente a partir do WhatsApp.
 */
function telefoneE164BR(sugestao: string | null): string {
  if (!sugestao) return "";
  const d = sugestao.replace(/\D/g, "");
  if (!d) return "";
  // Já vem com código do país (ex.: JID 5511950218830).
  if (d.startsWith("55") && d.length >= 12) return d;
  // DDD + número (10 ou 11 dígitos) → prefixa 55.
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function sugestaoBusca(sugestao: string, canal: "whatsapp" | "email"): string {
  if (canal === "email") return sugestao;
  const digits = sugestao.replace(/\D/g, "");
  // 13 dígitos = formato BR completo (55 + DDD + 9 dígitos). Tira o 55
  // para ficar com DDD + número, que é o que costuma estar no cadastro.
  const semCodigoPais =
    digits.length === 13 && digits.startsWith("55") ? digits.slice(2) : digits;
  // 11 dígitos = DDD (2) + número (9). Formata "(XX) XXXXX-XXXX".
  if (semCodigoPais.length === 11) {
    return `(${semCodigoPais.slice(0, 2)}) ${semCodigoPais.slice(2, 7)}-${semCodigoPais.slice(7)}`;
  }
  // 10 dígitos = DDD + número antigo (8 dígitos, pré-2012). "(XX) XXXX-XXXX".
  if (semCodigoPais.length === 10) {
    return `(${semCodigoPais.slice(0, 2)}) ${semCodigoPais.slice(2, 6)}-${semCodigoPais.slice(6)}`;
  }
  return semCodigoPais;
}
