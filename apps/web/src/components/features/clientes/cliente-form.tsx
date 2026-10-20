import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Check, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDebounced } from "@/hooks/use-debounced";
import { msgErro } from "@/lib/erro";
import { cnpjNaoEncontrado, fetchCep, fetchCnpj, onlyDigits } from "@/lib/lookups";
import { isValidCnpj, maskCep, maskCpfCnpj, maskTelefone, normalizarDoc } from "@/lib/masks";
import {
  type Cliente,
  useClientePorDoc,
  useClientePorEmail,
  useClientesPorTelefone,
  useCreateCliente,
  useUpdateCliente,
} from "@/lib/queries/clientes";
import { toast } from "@/lib/toast";
import {
  type ClienteFormValues,
  type ClienteInput,
  clienteSchema,
  ESTADOS_BR,
  REGIMES,
} from "@/lib/validations/cliente";

type Props =
  | { mode: "create"; clienteId?: undefined; defaults?: undefined }
  | { mode: "edit"; clienteId: string; defaults: Cliente };

/**
 * Cadastro de cliente. Portado do adv3 (máscaras, CEP pelo ViaCEP, CNPJ pela
 * BrasilAPI, alerta de duplicado) e enxugado para o escritório contábil:
 * saiu a qualificação de procuração; entraram regime tributário e data de
 * abertura (PJ) / nascimento (PF), que alimentam os Aniversários.
 */
export function ClienteForm(props: Props) {
  const navigate = useNavigate();
  const create = useCreateCliente();
  const update = useUpdateCliente(props.clienteId ?? "");
  const pending = create.isPending || update.isPending;
  const [cepLoading, setCepLoading] = useState(false);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  // Endereço fica bloqueado até o CEP ser confirmado. Em edição já existe.
  const [cepConfirmado, setCepConfirmado] = useState(props.mode === "edit");

  const d = props.defaults;
  // Versão do cadastro quando o formulário abriu (trava otimista ao salvar).
  // Presa no primeiro render: uma releitura da página não pode "aceitar" por
  // baixo dos panos a alteração de um colega.
  const [versao] = useState(d?.atualizadoEm);
  const form = useForm<ClienteFormValues, unknown, ClienteInput>({
    // @hookform/resolvers v3 tipa a saída igual à entrada; o zod transforma
    // ("" → undefined), então a saída real é ClienteInput.
    resolver: zodResolver(clienteSchema) as unknown as Resolver<ClienteFormValues, unknown, ClienteInput>,
    defaultValues: d
      ? {
          tipo: d.tipo,
          nome: d.nome,
          nomeFantasia: d.nomeFantasia ?? "",
          cpfCnpj: d.cpfCnpj ? maskCpfCnpj(d.cpfCnpj) : "",
          email: d.email ?? "",
          telefone: d.telefone ? maskTelefone(d.telefone) : "",
          dataNascimento: d.dataNascimento ?? "",
          dataAbertura: d.dataAbertura ?? "",
          regimeTributario: d.regimeTributario ?? "",
          inscricaoEstadual: d.inscricaoEstadual ?? "",
          inscricaoMunicipal: d.inscricaoMunicipal ?? "",
          cep: d.cep ? maskCep(d.cep) : "",
          rua: d.rua ?? "",
          numero: d.numero ?? "",
          complemento: d.complemento ?? "",
          bairro: d.bairro ?? "",
          cidade: d.cidade ?? "",
          estado: d.estado ?? "",
          observacoes: d.observacoes ?? "",
          ativo: d.ativo,
        }
      : { tipo: "PJ", nome: "", ativo: true, regimeTributario: "" },
  });

  // Pré-preenche o telefone quando o cadastro vem de uma conversa.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (props.mode !== "create") return;
    const tel = searchParams.get("telefone");
    if (tel && !form.getValues("telefone")) {
      let dg = tel.replace(/\D/g, "");
      if (dg.startsWith("55") && dg.length >= 12) dg = dg.slice(2);
      form.setValue("telefone", maskTelefone(dg), { shouldDirty: true });
    }
  }, [props.mode, searchParams, form]);

  const [dataInvalida, setDataInvalida] = useState(false);
  const aoErroData = useCallback((e: string | null) => setDataInvalida(!!e), []);
  const docRaw = form.watch("cpfCnpj") ?? "";
  const tipoAtual = form.watch("tipo");
  const debouncedDoc = useDebounced(docRaw, 600);

  async function confirmarCep() {
    const sanit = onlyDigits(form.getValues("cep") ?? "");
    if (sanit.length !== 8) {
      toast.warning("Digite um CEP com 8 dígitos.");
      return;
    }
    setCepLoading(true);
    const info = await fetchCep(sanit);
    setCepLoading(false);
    if (!info) {
      toast.warning("CEP não encontrado.");
      return;
    }
    form.setValue("rua", info.logradouro, { shouldDirty: true, shouldValidate: true });
    form.setValue("bairro", info.bairro, { shouldDirty: true });
    form.setValue("cidade", info.cidade, { shouldDirty: true });
    form.setValue("estado", info.estado, { shouldDirty: true });
    setCepConfirmado(true);
  }

  // CNPJ completo (PJ): importa os dados da Receita via BrasilAPI.
  useEffect(() => {
    if (tipoAtual !== "PJ" || props.mode === "edit") return;
    const sanit = normalizarDoc(debouncedDoc);
    // Dígitos verificadores errados: nem chama a BrasilAPI (o campo já mostra "inválido").
    if (!isValidCnpj(sanit)) return;
    let active = true;
    setCnpjLoading(true);
    void fetchCnpj(sanit).then((info) => {
      if (!active) return;
      setCnpjLoading(false);
      if (!info) {
        if (cnpjNaoEncontrado(sanit)) toast.warning("CNPJ não encontrado na Receita. Confira os números ou preencha os dados à mão.");
        return;
      }
      const set = <K extends keyof ClienteFormValues>(k: K, v: string | null | undefined) => {
        if (!form.getValues(k) && v) form.setValue(k, v as never, { shouldDirty: true });
      };
      set("nome", info.razaoSocial);
      set("nomeFantasia", info.fantasia);
      set("email", info.email?.toLowerCase());
      set("telefone", info.telefone ? maskTelefone(info.telefone) : info.telefone);
      set("dataAbertura", info.dataAbertura);
      set("regimeTributario", info.regime);
      set("cep", info.cep ? maskCep(info.cep) : info.cep);
      set("rua", info.logradouro);
      set("numero", info.numero);
      set("complemento", info.complemento);
      set("bairro", info.bairro);
      set("cidade", info.cidade);
      set("estado", info.estado);
      setCepConfirmado(true);
      if (info.situacao && info.situacao.toUpperCase() !== "ATIVA") {
        toast.warning(`Situação na Receita: ${info.situacao}`);
      } else {
        toast.info("Dados da empresa importados da Receita.");
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedDoc, tipoAtual]);

  // Duplicados (CPF/CNPJ, e-mail, telefone) em OUTRO cliente.
  const ignorar = props.mode === "edit" ? props.clienteId : undefined;
  const docSanit = normalizarDoc(debouncedDoc);
  const duplicado = useClientePorDoc(docSanit.length >= 11 ? docSanit : undefined, ignorar).data;
  const debouncedEmail = useDebounced(form.watch("email") ?? "", 600);
  const duplicadoEmail = useClientePorEmail(debouncedEmail, ignorar).data;
  const debouncedTel = useDebounced(form.watch("telefone") ?? "", 600);
  const duplicadoTel = useClientesPorTelefone(debouncedTel, ignorar).data?.[0];
  // Telefone repetido só avisa (sócio e empresa podem dividir o número);
  // CPF/CNPJ e e-mail repetidos bloqueiam.
  const duplicadoBloqueio = !!duplicado || !!duplicadoEmail;

  function masked(name: keyof ClienteFormValues, fn: (v: string) => string) {
    const reg = form.register(name);
    return {
      ...reg,
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        e.target.value = fn(e.target.value);
        return reg.onChange(e);
      },
    };
  }

  const cepReg = form.register("cep");
  const cepField = {
    ...cepReg,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      e.target.value = maskCep(e.target.value);
      if (cepConfirmado) setCepConfirmado(false);
      return cepReg.onChange(e);
    },
  };

  async function onSubmit(values: ClienteInput) {
    if (dataInvalida) {
      toast.error("Corrija a data antes de salvar.");
      return;
    }
    if (duplicadoBloqueio) {
      toast.error(
        duplicadoEmail
          ? "Já existe um cliente com esse e-mail."
          : "Já existe um cliente com esse CPF/CNPJ.",
      );
      return;
    }
    // A data que não se aplica ao tipo não vai pro banco.
    const payload: ClienteInput = {
      ...values,
      dataNascimento: values.tipo === "PF" ? values.dataNascimento : undefined,
      dataAbertura: values.tipo === "PJ" ? values.dataAbertura : undefined,
      // Regime e inscrições são de empresa: não vão no cadastro de pessoa física.
      ...(values.tipo === "PF" ? { regimeTributario: undefined, inscricaoEstadual: undefined, inscricaoMunicipal: undefined } : {}),
    };
    try {
      if (props.mode === "create") {
        const created = await create.mutateAsync(payload);
        navigate(`/clientes/${created.id}`);
      } else {
        // Só o que a pessoa mexeu: regravar o formulário inteiro apagava o que
        // um colega salvou nos outros campos enquanto esta tela estava aberta.
        // Trocar o tipo leva junto os campos que dependem dele.
        const dirty = dirtyFields as Partial<Record<keyof ClienteInput, unknown>>;
        const mexidos = new Set(Object.keys(dirty).filter((k) => dirty[k as keyof ClienteInput]));
        if (mexidos.has("tipo")) {
          for (const k of ["dataNascimento", "dataAbertura", "regimeTributario", "inscricaoEstadual", "inscricaoMunicipal"]) mexidos.add(k);
        }
        const parcial = Object.fromEntries(
          [...mexidos].map((k) => [k, payload[k as keyof ClienteInput]]),
        ) as Partial<ClienteInput>;
        if (mexidos.size) await update.mutateAsync({ input: parcial, atualizadoEm: versao! });
        navigate(`/clientes/${props.clienteId}`);
      }
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  const erros = form.formState.errors;
  // Lido no render de propósito: o formState do react-hook-form é um proxy e só
  // acompanha os campos alterados de quem o lê.
  const { dirtyFields } = form.formState;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
      <Section title="Identificação" description="Tipo, nome e documento.">
        <Field label="Tipo" htmlFor="tipo" error={erros.tipo?.message} required>
          <Select value={form.watch("tipo")} onValueChange={(v) => form.setValue("tipo", v as "PF" | "PJ", { shouldDirty: true })}>
            <SelectTrigger id="tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PJ">Pessoa jurídica (empresa)</SelectItem>
              <SelectItem value="PF">Pessoa física</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          label={tipoAtual === "PJ" ? "CNPJ" : "CPF"}
          htmlFor="cpfCnpj"
          error={erros.cpfCnpj?.message}
          help={tipoAtual === "PJ" && props.mode === "create" ? "Com o CNPJ completo, os dados vêm da Receita." : undefined}
        >
          <div className="relative">
            {/* CNPJ alfanumérico (2026) tem letras: teclado de texto, maiúsculas. */}
            <Input id="cpfCnpj" inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} {...masked("cpfCnpj", maskCpfCnpj)} />
            {cnpjLoading ? (
              <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />
            ) : null}
          </div>
          {duplicado ? (
            <Aviso>
              Já existe cliente com este documento:{" "}
              <Link to={`/clientes/${duplicado.id}`} className="font-medium underline">
                {duplicado.nome}
              </Link>
            </Aviso>
          ) : null}
        </Field>
        <Field
          label={tipoAtual === "PJ" ? "Razão social" : "Nome completo"}
          htmlFor="nome"
          error={erros.nome?.message}
          required
          full
        >
          <Input id="nome" {...form.register("nome")} />
        </Field>
        {tipoAtual === "PJ" && (
          <Field label="Nome fantasia" htmlFor="nomeFantasia" error={erros.nomeFantasia?.message} full>
            <Input id="nomeFantasia" {...form.register("nomeFantasia")} />
          </Field>
        )}
        {tipoAtual === "PJ" ? (
          <Field
            label="Data de abertura"
            htmlFor="dataAbertura"
            error={erros.dataAbertura?.message}
            help="Aniversário da empresa."
          >
            <DatePicker
              id="dataAbertura"
              limpavel
              value={form.watch("dataAbertura") ?? ""}
              onErroChange={aoErroData}
              onChange={(v) => form.setValue("dataAbertura", v, { shouldDirty: true, shouldValidate: true })}
            />
          </Field>
        ) : (
          <Field label="Data de nascimento" htmlFor="dataNascimento" error={erros.dataNascimento?.message}>
            <DatePicker
              id="dataNascimento"
              limpavel
              value={form.watch("dataNascimento") ?? ""}
              onErroChange={aoErroData}
              onChange={(v) => form.setValue("dataNascimento", v, { shouldDirty: true, shouldValidate: true })}
            />
          </Field>
        )}
      </Section>

      <Section title="Contato" description="Telefone vincula o cliente às conversas do WhatsApp.">
        <Field label="Telefone / WhatsApp" htmlFor="telefone" error={erros.telefone?.message}>
          <Input id="telefone" inputMode="tel" placeholder="(17) 91234-5678" {...masked("telefone", maskTelefone)} />
          {duplicadoTel ? (
            <Aviso>
              Outro cliente usa este telefone:{" "}
              <Link to={`/clientes/${duplicadoTel.id}`} className="font-medium underline">
                {duplicadoTel.nome}
              </Link>
            </Aviso>
          ) : null}
        </Field>
        <Field label="E-mail" htmlFor="email" error={erros.email?.message}>
          <Input id="email" type="email" {...form.register("email")} />
          {duplicadoEmail ? (
            <Aviso>
              Já existe cliente com este e-mail:{" "}
              <Link to={`/clientes/${duplicadoEmail.id}`} className="font-medium underline">
                {duplicadoEmail.nome}
              </Link>
            </Aviso>
          ) : null}
        </Field>
      </Section>

      {tipoAtual === "PJ" && (
      <Section title="Fiscal" description="Regime e inscrições.">
        <Field label="Regime tributário" htmlFor="regime" error={erros.regimeTributario?.message}>
          <Select
            value={form.watch("regimeTributario") || "__nenhum__"}
            onValueChange={(v) =>
              form.setValue("regimeTributario", (v === "__nenhum__" ? "" : v) as ClienteFormValues["regimeTributario"], { shouldDirty: true })
            }
          >
            <SelectTrigger id="regime">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__nenhum__">Não informado</SelectItem>
              {REGIMES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Inscrição estadual" htmlFor="ie" error={erros.inscricaoEstadual?.message}>
          <Input id="ie" {...form.register("inscricaoEstadual")} />
        </Field>
        <Field label="Inscrição municipal" htmlFor="im" error={erros.inscricaoMunicipal?.message}>
          <Input id="im" {...form.register("inscricaoMunicipal")} />
        </Field>
      </Section>
      )}

      <Section
        title="Endereço"
        description={
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3" />
            Digite o CEP e confirme, o endereço é preenchido.
          </span>
        }
      >
        <Field label="CEP" htmlFor="cep" error={erros.cep?.message} full>
          <div className="flex gap-2">
            <div className="relative flex-1 sm:max-w-[200px]">
              <Input
                id="cep"
                inputMode="numeric"
                placeholder="00000-000"
                {...cepField}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void confirmarCep();
                  }
                }}
              />
              {cepLoading ? (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />
              ) : null}
            </div>
            <Button
              type="button"
              variant={cepConfirmado ? "outline" : "default"}
              onClick={() => void confirmarCep()}
              disabled={cepLoading}
              className="shrink-0"
            >
              {cepLoading ? <Loader2 className="animate-spin" /> : <Check />}
              Confirmar CEP
            </Button>
          </div>
          {!cepConfirmado ? (
            <button
              type="button"
              onClick={() => setCepConfirmado(true)}
              className="mt-1.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground max-lg:-my-3 max-lg:py-3"
            >
              Não tenho o CEP, preencher manualmente
            </button>
          ) : null}
        </Field>
        <Field label="Rua" htmlFor="rua" error={erros.rua?.message} full>
          <Input id="rua" disabled={!cepConfirmado} {...form.register("rua")} />
        </Field>
        <Field label="Número" htmlFor="numero" error={erros.numero?.message}>
          <Input id="numero" disabled={!cepConfirmado} {...form.register("numero")} />
        </Field>
        <Field label="Complemento" htmlFor="complemento" error={erros.complemento?.message}>
          <Input id="complemento" disabled={!cepConfirmado} {...form.register("complemento")} />
        </Field>
        <Field label="Bairro" htmlFor="bairro" error={erros.bairro?.message}>
          <Input id="bairro" disabled={!cepConfirmado} {...form.register("bairro")} />
        </Field>
        <Field label="Cidade" htmlFor="cidade" error={erros.cidade?.message}>
          <Input id="cidade" disabled={!cepConfirmado} {...form.register("cidade")} />
        </Field>
        <Field label="Estado" htmlFor="estado" error={erros.estado?.message}>
          <Select
            value={form.watch("estado") ?? ""}
            onValueChange={(v) => form.setValue("estado", v, { shouldDirty: true })}
            disabled={!cepConfirmado}
          >
            <SelectTrigger id="estado">
              <SelectValue placeholder="UF" />
            </SelectTrigger>
            <SelectContent>
              {ESTADOS_BR.map((uf) => (
                <SelectItem key={uf} value={uf}>
                  {uf}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Section>

      <Section title="Observações" description="Notas internas sobre o cliente.">
        <Field label="Observações" htmlFor="observacoes" error={erros.observacoes?.message} full>
          <Textarea id="observacoes" rows={4} {...form.register("observacoes")} />
        </Field>
        {props.mode === "edit" && (
          <label className="col-span-full flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" {...form.register("ativo")} />
            Cliente ativo (inativos somem das listas e dos aniversários)
          </label>
        )}
      </Section>

      <div className="flex items-center justify-end gap-3 pt-2 flex-wrap">
        {duplicadoBloqueio ? (
          <p className="text-xs text-destructive">
            {duplicadoEmail ? "E-mail já cadastrado em outro cliente." : "CPF/CNPJ já cadastrado em outro cliente."}
          </p>
        ) : null}
        <Link
          to={props.clienteId ? `/clientes/${props.clienteId}` : "/clientes"}
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancelar
        </Link>
        <Button type="submit" disabled={pending || duplicadoBloqueio}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {props.mode === "edit" ? "Salvar" : "Cadastrar cliente"}
        </Button>
      </div>
    </form>
  );
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
      <AlertCircle className="size-3.5 text-warning shrink-0 mt-0.5" />
      <p className="flex-1 min-w-0">{children}</p>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 border-b border-border pb-8 last:border-0">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  error,
  required,
  full,
  help,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  full?: boolean;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${full ? "col-span-full" : ""}`}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-destructive ml-0.5">*</span> : null}
      </Label>
      {children}
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
