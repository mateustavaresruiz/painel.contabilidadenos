// Acesso ao banco do portal (service_role). Cada consulta lista as colunas que
// quer: o portal público nunca faz `select *`.
import { supabaseAdmin, TENANT_ID } from "../_shared/supabase.ts";
import type { EventoAuditoria, Repo, TokenOffice, TokenRow } from "./handler.ts";
import type { CertRow, ChamadoRow, ClienteRow } from "./payload.ts";

const COLS_CLIENTE =
  'id, tipo, nome, "nomeFantasia", "cpfCnpj", "regimeTributario", cidade, estado, ativo, "portalMostrarSituacaoFiscal"';

function um<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export const repoReal: Repo = {
  async moduloAtivo() {
    const { data } = await supabaseAdmin.from("Config").select("valor").eq("chave", "modulos").maybeSingle();
    const v = (data?.valor ?? {}) as Record<string, unknown>;
    // Ligado enquanto ninguém desligar explicitamente (padrão do painel).
    return v.portalCliente !== false && v.clientes !== false;
  },

  async tokenPorHash(hash) {
    const { data, error } = await supabaseAdmin
      .from("ClientePortalToken")
      .select('id, "clienteId", "senhaHash", "expiresAt", "revogadoEm", "bloqueadoAte"')
      .eq("tokenHash", hash)
      .maybeSingle();
    if (error) throw error;
    return (data as TokenRow | null) ?? null;
  },

  async cliente(id) {
    const { data, error } = await supabaseAdmin
      .from("Cliente").select(COLS_CLIENTE).eq("tenantId", TENANT_ID).eq("id", id).maybeSingle();
    if (error) throw error;
    return (data as ClienteRow | null) ?? null;
  },

  async registrarAcesso(tokenId) {
    const { error } = await supabaseAdmin.rpc("portal_registrar_acesso", { p_id: tokenId });
    if (error) console.warn("portal: registrar acesso falhou", error.message);
  },

  async registrarFalha(tokenId) {
    const { data, error } = await supabaseAdmin.rpc("portal_registrar_falha", { p_id: tokenId });
    if (error) {
      console.warn("portal: registrar falha falhou", error.message);
      return null;
    }
    return typeof data === "string" ? data : null;
  },

  async escritorio() {
    const [t, s] = await Promise.all([
      supabaseAdmin.from("Tenant").select("nome").eq("id", TENANT_ID).maybeSingle(),
      supabaseAdmin
        .from("WhatsappSessao")
        .select("numero")
        .eq("tenantId", TENANT_ID)
        .eq("status", "WORKING")
        .not("numero", "is", null)
        .order("criadoEm", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    return { nome: (t.data?.nome as string | undefined) ?? "NÓS Contabilidade", whatsapp: (s.data?.numero as string | undefined) ?? null };
  },

  async chamados(clienteId) {
    const { data, error } = await supabaseAdmin
      .from("Solicitacao")
      .select("status, descricao, prazo, concluidaEm, criadoEm, origem, tipo:SolicitacaoTipo(nome)")
      .eq("tenantId", TENANT_ID)
      .eq("clienteId", clienteId)
      .order("criadoEm", { ascending: false })
      .limit(30);
    if (error) throw error;
    return (data ?? []).map((r: Record<string, unknown>): ChamadoRow => ({
      status: String(r.status),
      descricao: (r.descricao as string | null) ?? null,
      prazo: (r.prazo as string | null) ?? null,
      concluidaEm: (r.concluidaEm as string | null) ?? null,
      criadoEm: String(r.criadoEm),
      origem: String(r.origem ?? "painel"),
      tipoNome: um(r.tipo as { nome: string } | { nome: string }[] | null)?.nome ?? null,
    }));
  },

  async tiposAtivos() {
    const { data, error } = await supabaseAdmin
      .from("SolicitacaoTipo").select("id, nome").eq("tenantId", TENANT_ID).eq("ativo", true).order("ordem").order("nome");
    if (error) throw error;
    return (data ?? []) as { id: string; nome: string }[];
  },

  async certificados(clienteId) {
    const { data, error } = await supabaseAdmin
      .from("CertificadoDigital")
      .select('tipo, "validoAte"')
      .eq("tenantId", TENANT_ID)
      .eq("clienteId", clienteId)
      .is("renovadoPorId", null)
      .order("validoAte", { ascending: true })
      .limit(20);
    if (error) throw error;
    return (data ?? []) as CertRow[];
  },

  async ultimaSituacaoFiscal(clienteId) {
    const { data, error } = await supabaseAdmin
      .from("ConsultaFiscal")
      .select('status, "criadoEm"')
      .eq("tenantId", TENANT_ID)
      .eq("clienteId", clienteId)
      .eq("servico", "SITFIS")
      .in("status", ["ok", "com_pendencia"])
      .order("criadoEm", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as { status: string; criadoEm: string } | null) ?? null;
  },

  async chamadosPortalAbertos(clienteId) {
    const { count, error } = await supabaseAdmin
      .from("Solicitacao")
      .select("id", { count: "exact", head: true })
      .eq("clienteId", clienteId)
      .eq("origem", "portal")
      .in("status", ["aberta", "em_andamento"]);
    if (error) throw error;
    return count ?? 0;
  },

  async criarChamado({ tipoId, clienteId, descricao }) {
    const { data, error } = await supabaseAdmin
      .from("Solicitacao")
      .insert({ tenantId: TENANT_ID, tipoId, clienteId, descricao, status: "aberta", origem: "portal", criadoPorId: null, responsavelId: null })
      .select("id")
      .single();
    if (error) {
      console.error("portal: criar chamado falhou", error.message);
      return null;
    }
    return { id: (data as { id: string }).id };
  },

  async auditar(e: EventoAuditoria) {
    const { error } = await supabaseAdmin.rpc("auditoria_evento", {
      p_modulo: "portal",
      p_entidade: "portal",
      p_entidade_id: e.clienteId,
      p_acao: e.acao,
      p_resumo: e.resumo,
      p_detalhes: e.info?.length ? { info: e.info } : null,
      p_cliente: e.clienteId,
      p_chat: null,
      p_solic: e.solicitacaoId ?? null,
      p_ator: null,
      p_origem: "sistema",
    });
    if (error) throw error;
  },

  // ---- escritório ----
  async clienteBasico(id) {
    const { data } = await supabaseAdmin.from("Cliente").select('id, nome, "nomeFantasia"').eq("tenantId", TENANT_ID).eq("id", id).maybeSingle();
    const c = data as { id: string; nome: string; nomeFantasia: string | null } | null;
    // Nome de exibição (o mesmo do painel): nome fantasia quando houver.
    return c ? { id: c.id, nome: c.nomeFantasia?.trim() || c.nome } : null;
  },

  async listarTokens(clienteId) {
    const { data, error } = await supabaseAdmin
      .from("ClientePortalToken")
      .select('id, "criadoEm", "expiresAt", "revogadoEm", "ultimoAcessoEm", acessos, "bloqueadoAte", criadoPor:Colaborador(nome)')
      .eq("clienteId", clienteId)
      .order("criadoEm", { ascending: false })
      .limit(10);
    if (error) throw error;
    return (data ?? []).map((r: Record<string, unknown>): TokenOffice => ({
      id: String(r.id),
      criadoEm: String(r.criadoEm),
      expiresAt: (r.expiresAt as string | null) ?? null,
      revogadoEm: (r.revogadoEm as string | null) ?? null,
      ultimoAcessoEm: (r.ultimoAcessoEm as string | null) ?? null,
      acessos: Number(r.acessos ?? 0),
      bloqueadoAte: (r.bloqueadoAte as string | null) ?? null,
      criadoPorNome: um(r.criadoPor as { nome: string } | { nome: string }[] | null)?.nome ?? null,
    }));
  },

  async revogarAtivos(clienteId) {
    const { data, error } = await supabaseAdmin
      .from("ClientePortalToken")
      .update({ revogadoEm: new Date().toISOString() })
      .eq("clienteId", clienteId)
      .is("revogadoEm", null)
      .select("id");
    if (error) throw error;
    return data?.length ?? 0;
  },

  async trocarToken({ clienteId, tokenHash, senhaHash, expiresAt, criadoPorId }) {
    // Revogar os outros e gravar o novo na mesma transação (migration 013): o
    // índice "um link ativo por cliente" não deixa o novo entrar antes, e fazer
    // em dois passos deixava o cliente sem link quando a gravação falhava.
    const { data, error } = await supabaseAdmin.rpc("portal_token_trocar", {
      p_cliente: clienteId,
      p_token_hash: tokenHash,
      p_senha_hash: senhaHash,
      p_expira: expiresAt,
      p_por: criadoPorId,
    });
    if (error) {
      console.error("portal: trocar token falhou", error.message);
      return null;
    }
    return typeof data === "string" && data ? data : null;
  },

  async trocarSenha(clienteId, senhaHash) {
    const { data, error } = await supabaseAdmin
      .from("ClientePortalToken")
      .update({ senhaHash, falhas: 0, bloqueadoAte: null })
      .eq("clienteId", clienteId)
      .is("revogadoEm", null)
      .select("id");
    if (error) throw error;
    return data?.length ?? 0;
  },

  async definirSituacaoFiscal(clienteId, valor) {
    const { error } = await supabaseAdmin
      .from("Cliente").update({ portalMostrarSituacaoFiscal: valor }).eq("tenantId", TENANT_ID).eq("id", clienteId);
    return !error;
  },
};
