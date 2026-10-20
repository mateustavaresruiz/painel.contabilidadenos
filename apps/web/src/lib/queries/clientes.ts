import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { normalizarDoc } from "@/lib/masks";
import { nullificarVazios } from "@/lib/queries/helpers";
import { compararTexto } from "@/lib/texto";
import { supabase } from "@/lib/supabase";
import type { ClienteInput, RegimeTributario } from "@/lib/validations/cliente";

const TABLE = "Cliente";

export type Cliente = {
  id: string;
  tipo: "PF" | "PJ";
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
  email: string | null;
  telefone: string | null;
  telefoneNormalizado: string | null;
  dataNascimento: string | null;
  dataAbertura: string | null;
  regimeTributario: RegimeTributario | null;
  inscricaoEstadual: string | null;
  inscricaoMunicipal: string | null;
  cep: string | null;
  rua: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  observacoes: string | null;
  ativo: boolean;
  /** Nasceu de uma conversa do WhatsApp (nome + número), sem e-mail nem CPF/CNPJ (migration 008). */
  provisorio: boolean;
  criadoEm: string;
  atualizadoEm: string;
};

export type ClienteResumo = Pick<
  Cliente,
  | "id"
  | "tipo"
  | "nome"
  | "nomeFantasia"
  | "cpfCnpj"
  | "email"
  | "telefone"
  | "regimeTributario"
  | "cidade"
  | "estado"
  | "ativo"
  | "provisorio"
  | "criadoEm"
>;

export type ClientesFilters = {
  q?: string;
  tipo?: "PF" | "PJ" | "";
  regime?: RegimeTributario | "";
  /** "ativos" (padrão), "inativos" ou "todos". */
  situacao?: "ativos" | "inativos" | "todos";
  /** Só os cadastros provisórios (criados pelo WhatsApp, sem e-mail nem CPF/CNPJ). */
  incompletos?: boolean;
};

/** Teto da lista na tela: chegou nele, a tela avisa e pede para refinar a busca. */
export const LIMITE_CLIENTES = 500;

const COLUNAS_LISTA =
  "id, tipo, nome, nomeFantasia, cpfCnpj, email, telefone, regimeTributario, cidade, estado, ativo, provisorio, criadoEm";

/**
 * Consulta da lista com os filtros da tela, sem ordem nem teto. A lista e o
 * Exportar (lib/exportar.ts) usam a mesma: o arquivo traz exatamente
 * os clientes que casam com o que está na tela.
 */
/** `colunas`: o Exportar (lib/exportar.ts) pede "*" para levar o cadastro inteiro. */
export function consultaClientes(filters: ClientesFilters, colunas: string = COLUNAS_LISTA) {
  const q = filters.q?.trim();
  // Com busca: RPC buscar_clientes (migration 018), sem acento, por
  // CPF/CNPJ e telefone (dígitos) e por nome de sócio. Mesma RLS de um select.
  let query = q
    ? supabase.rpc("buscar_clientes", { p_q: q }).select(colunas)
    : supabase.from(TABLE).select(colunas);
  if (filters.tipo === "PF" || filters.tipo === "PJ") query = query.eq("tipo", filters.tipo);
  if (filters.regime) query = query.eq("regimeTributario", filters.regime);
  const situacao = filters.situacao ?? "ativos";
  if (situacao === "ativos") query = query.eq("ativo", true);
  if (situacao === "inativos") query = query.eq("ativo", false);
  if (filters.incompletos) query = query.eq("provisorio", true);
  return query;
}

export function useClientes(filters: ClientesFilters) {
  return useQuery({
    queryKey: ["clientes", "lista", filters],
    // Trocar filtro ou busca mantém a lista anterior até a nova chegar.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await consultaClientes(filters)
        .order("nome", { ascending: true })
        .limit(LIMITE_CLIENTES);
      if (error) throw error;
      // Ordem do nome que aparece (fantasia quando houver), não da razão social.
      return ((data ?? []) as unknown as ClienteResumo[]).sort((a, b) =>
        compararTexto(nomeExibicao(a), nomeExibicao(b)),
      );
    },
  });
}

/** Quantos cadastros provisórios (incompletos) existem — o número do chip "Incompletos". */
export function useContagemIncompletos() {
  return useQuery({
    queryKey: ["clientes", "incompletos"],
    staleTime: 30_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from(TABLE)
        .select("id", { count: "exact", head: true })
        .eq("provisorio", true);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/**
 * Cliente da conversa, garantido (RPC `garantir_cliente_da_conversa`,
 * migration 008): já vinculado → devolve; senão vincula pelo telefone ou cria
 * um cadastro PROVISÓRIO com o nome e o número do WhatsApp. Grupo ou conversa
 * sem número → null. Usado antes de gravar um chamado aberto pela conversa.
 */
export async function garantirClienteDaConversa(
  chatRowId: string,
): Promise<{ id: string; nome: string; provisorio: boolean } | null> {
  const { data, error } = await supabase.rpc("garantir_cliente_da_conversa", { p_chat: chatRowId });
  if (error) throw error;
  const id = (data as string | null) ?? null;
  if (!id) return null;
  const { data: c } = await supabase
    .from(TABLE)
    .select("id, nome, nomeFantasia, provisorio")
    .eq("id", id)
    .maybeSingle();
  return {
    id,
    nome: c ? nomeExibicao(c as Pick<Cliente, "nome" | "nomeFantasia">) : "",
    provisorio: !!(c as { provisorio?: boolean } | null)?.provisorio,
  };
}

/** Procura um cliente existente pelo CPF/CNPJ. */
export function useClientePorDoc(doc: string | undefined, ignorarId?: string) {
  return useQuery({
    queryKey: ["cliente-por-doc", doc, ignorarId],
    enabled: !!doc && normalizarDoc(doc).length >= 11,
    staleTime: 30_000,
    queryFn: async () => {
      // Mesma normalização do banco: o CNPJ alfanumérico guarda as letras.
      const sanit = normalizarDoc(doc!);
      let q = supabase.from(TABLE).select("id, nome, tipo, cpfCnpj").eq("cpfCnpj", sanit).limit(1);
      if (ignorarId) q = q.neq("id", ignorarId);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return data as { id: string; nome: string; tipo: "PF" | "PJ"; cpfCnpj: string | null } | null;
    },
  });
}

/** Procura um cliente existente pelo e-mail (sem diferenciar maiúsculas). */
export function useClientePorEmail(email: string | undefined, ignorarId?: string) {
  const normalizado = email?.trim().toLowerCase();
  return useQuery({
    queryKey: ["cliente-por-email", normalizado, ignorarId],
    enabled: !!normalizado && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizado),
    staleTime: 30_000,
    queryFn: async () => {
      // `_` e `%` são curingas do LIKE: "joao_silva@x.com" casava com
      // "joaoXsilva@x.com" e acusava duplicado falso. Escapados (com a própria
      // barra), viram o caractere literal. Uma barra só: fora do `.or()` o
      // PostgREST não consome nenhuma (ver orIlike em helpers.ts).
      const literal = normalizado!.replace(/[\\%_]/g, (c) => `\\${c}`);
      let q = supabase.from(TABLE).select("id, nome, email").ilike("email", literal).limit(1);
      if (ignorarId) q = q.neq("id", ignorarId);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return data as { id: string; nome: string; email: string | null } | null;
    },
  });
}

/**
 * Clientes com este telefone, pela RPC `cliente_por_telefone` (normaliza no
 * banco e tolera o 9º dígito — o adv3 não tolerava, defeito 46).
 */
export async function buscarClientesPorTelefone(
  telefone: string | null | undefined,
): Promise<Pick<Cliente, "id" | "nome" | "tipo" | "nomeFantasia" | "telefone">[]> {
  const d = (telefone ?? "").replace(/\D/g, "");
  if (d.length < 10) return [];
  const { data, error } = await supabase.rpc("cliente_por_telefone", { p_telefone: d });
  if (error) throw error;
  return ((data ?? []) as Cliente[]).map((c) => ({
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
    nomeFantasia: c.nomeFantasia,
    telefone: c.telefone,
  }));
}

/** Hook reativo: clientes com o mesmo telefone (alerta no form / sugestão no chat). */
export function useClientesPorTelefone(telefone: string | undefined, ignorarId?: string) {
  const d = (telefone ?? "").replace(/\D/g, "");
  return useQuery({
    queryKey: ["cliente-por-telefone", d, ignorarId],
    enabled: d.length >= 10,
    staleTime: 30_000,
    queryFn: async () => {
      const lista = await buscarClientesPorTelefone(d);
      return ignorarId ? lista.filter((c) => c.id !== ignorarId) : lista;
    },
  });
}

/**
 * `sempreFresco`: relê do banco ao abrir mesmo com o cliente guardado na
 * memória. A edição precisa disso: a trava otimista compara com o
 * "atualizadoEm" que o formulário abriu, e o cache pode estar velho (o Portal e
 * a importação mudam o Cliente sem renovar a ficha).
 */
export function useCliente(id: string | undefined | null, opts: { sempreFresco?: boolean } = {}) {
  return useQuery({
    queryKey: ["cliente", id],
    enabled: !!id,
    refetchOnMount: opts.sempreFresco ? "always" : true,
    queryFn: async () => {
      const { data, error } = await supabase.from(TABLE).select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data as Cliente | null;
    },
  });
}

export function useCreateCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClienteInput) => {
      // tenantId tem default 'denos' no banco — não enviamos.
      const { data, error } = await supabase.from(TABLE).insert(input).select("id").single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["aniversarios"] });
    },
  });
}

/** Lançado quando o cadastro mudou no banco depois que o formulário abriu. */
export const MSG_CLIENTE_ALTERADO =
  "Outra pessoa alterou este cliente enquanto você editava. Recarregue a página para ver a versão atual.";

export function useUpdateCliente(id: string) {
  const qc = useQueryClient();
  return useMutation({
    /**
     * `input` leva só os campos que a pessoa mexeu (o resto fica como está no
     * banco) e `atualizadoEm` é a versão que o formulário abriu: trava
     * otimista. Se alguém salvou no meio, nenhuma linha casa e nada é gravado.
     */
    mutationFn: async ({ input, atualizadoEm }: { input: Partial<ClienteInput>; atualizadoEm: string }) => {
      // nullificarVazios: campo limpo na edição precisa virar null para zerar
      // no banco — senão o supabase-js descarta a chave.
      const { data, error } = await supabase
        .from(TABLE)
        .update(nullificarVazios(input))
        .eq("id", id)
        .eq("atualizadoEm", atualizadoEm)
        .select("id");
      if (error) throw error;
      if (!data?.length) {
        // Nenhuma linha: ou outra pessoa salvou no meio, ou o cliente sumiu /
        // o cargo não pode editar. Só a primeira é "outra pessoa alterou".
        const { data: atual } = await supabase.from(TABLE).select("atualizadoEm").eq("id", id).maybeSingle();
        if (atual && atual.atualizadoEm !== atualizadoEm) throw new Error(MSG_CLIENTE_ALTERADO);
        throw new Error(atual ? "Seu cargo não pode editar este cliente." : "Este cliente não existe mais.");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["cliente", id] });
      qc.invalidateQueries({ queryKey: ["aniversarios"] });
    },
  });
}

export function useDeleteCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(TABLE).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["aniversarios"] });
      qc.invalidateQueries({ queryKey: ["certificados"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Sócios
// ---------------------------------------------------------------------------

export type Socio = {
  id: string;
  clienteId: string;
  nome: string;
  cpf: string | null;
  dataNascimento: string | null;
  telefone: string | null;
  email: string | null;
  participacao: number | null;
  administrador: boolean;
  criadoEm: string;
};

export type SocioInput = {
  nome: string;
  cpf?: string | null;
  dataNascimento?: string | null;
  telefone?: string | null;
  email?: string | null;
  participacao?: number | null;
  administrador?: boolean;
};

export function useSocios(clienteId: string | undefined | null) {
  return useQuery({
    queryKey: ["socios", clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Socio")
        .select("*")
        .eq("clienteId", clienteId!)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Socio[];
    },
  });
}

export function useSalvarSocio(clienteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id?: string; input: SocioInput }) => {
      const payload = {
        ...args.input,
        cpf: args.input.cpf ? args.input.cpf.replace(/\D/g, "") : null,
      };
      if (args.id) {
        const { error } = await supabase.from("Socio").update(payload).eq("id", args.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("Socio").insert({ ...payload, clienteId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["socios", clienteId] });
      qc.invalidateQueries({ queryKey: ["aniversarios"] });
    },
  });
}

export function useExcluirSocio(clienteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("Socio").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["socios", clienteId] });
      qc.invalidateQueries({ queryKey: ["aniversarios"] });
    },
  });
}

/**
 * Regra ÚNICA do nome do cliente no painel: o nome fantasia quando houver,
 * com a razão social de apoio (linha de baixo ou entre parênteses). A ordem
 * alfabética das listas usa este mesmo nome.
 */
export function nomeExibicao(c: Pick<Cliente, "nome" | "nomeFantasia"> | null | undefined): string {
  if (!c) return "";
  return c.nomeFantasia?.trim() || c.nome;
}

/** A razão social, quando é diferente do nome exibido (senão null). */
export function razaoSocialDeApoio(c: Pick<Cliente, "nome" | "nomeFantasia"> | null | undefined): string | null {
  if (!c) return null;
  const f = c.nomeFantasia?.trim();
  return f && f !== c.nome.trim() ? c.nome : null;
}

/** "Nome fantasia (Razão social)" numa linha só; sem fantasia, só o nome. */
export function nomeCompleto(c: Pick<Cliente, "nome" | "nomeFantasia"> | null | undefined): string {
  if (!c) return "";
  const r = razaoSocialDeApoio(c);
  return r ? `${nomeExibicao(c)} (${r})` : nomeExibicao(c);
}
