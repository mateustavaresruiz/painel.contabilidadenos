// Cliente da API PÚBLICA do portal (Edge Function `portal`). Sem login do painel.
//
// 🔴 NÃO use `api()` / `apiHeaders()` aqui. Elas mandam o JWT do colaborador e,
// num 401, DESLOGAM a pessoa: senha errada do cliente derrubaria a sessão de
// quem do escritório estivesse testando o link no mesmo navegador.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase";

export type EtapaPortal = {
  chave: "recebido" | "andamento" | "concluido" | "cancelado";
  rotulo: string;
  feito: boolean;
  atual: boolean;
  em: string | null;
};

export type ChamadoPortal = {
  tipo: string;
  status: "aberta" | "em_andamento" | "concluida" | "cancelada";
  statusRotulo: string;
  criadoEm: string;
  prazo: string | null;
  concluidaEm: string | null;
  descricao: string | null;
  doPortal: boolean;
  etapas: EtapaPortal[];
};

export type CertificadoPortal = {
  tipo: string;
  validoAte: string;
  diasRestantes: number;
  status: "valido" | "vencendo" | "vencido";
};

export type DadosPortal = {
  escritorio: { nome: string; whatsapp: string | null };
  cliente: {
    tipo: "PF" | "PJ";
    nome: string;
    nomeFantasia: string | null;
    documento: string | null;
    regimeTributario: string | null;
    cidade: string | null;
    estado: string | null;
  };
  chamados: ChamadoPortal[];
  tipos: { id: string; nome: string }[];
  certificados: CertificadoPortal[];
  situacaoFiscal: { situacao: "regular" | "pendencias" | "sem_consulta"; consultadoEm: string | null } | null;
  linkExpiraEm: string | null;
};

/** Resultado de uma chamada: nunca lança; a tela decide pelo `tipo`. */
export type SenhaObrigatoria = { senhaObrigatoria: true };

export type Resposta<T> =
  | { tipo: "ok"; dados: T }
  | { tipo: "senha"; mensagem: string } // 401
  | { tipo: "indisponivel" } // 404
  | { tipo: "limite"; mensagem: string } // 429
  | { tipo: "invalido"; mensagem: string } // 400/413
  | { tipo: "falha"; mensagem: string }; // rede / 5xx

const BASE = `${SUPABASE_URL}/functions/v1/portal`;

async function chamar<T>(caminho: string, init: { method?: string; senha?: string; corpo?: unknown } = {}): Promise<Resposta<T>> {
  const headers: Record<string, string> = { apikey: SUPABASE_ANON_KEY };
  if (init.senha) headers["X-Portal-Senha"] = init.senha;
  if (init.corpo !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${BASE}/${caminho.split("/").map(encodeURIComponent).join("/")}`, {
      method: init.method ?? "GET",
      headers,
      body: init.corpo !== undefined ? JSON.stringify(init.corpo) : undefined,
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
  } catch {
    return { tipo: "falha", mensagem: "Sem conexão. Verifique sua internet e tente de novo." };
  }
  let corpo: { error?: unknown } | null = null;
  try {
    corpo = (await res.json()) as { error?: unknown };
  } catch {
    corpo = null;
  }
  const msg = typeof corpo?.error === "string" ? corpo.error : "";
  if (res.ok) return { tipo: "ok", dados: corpo as T };
  if (res.status === 401) return { tipo: "senha", mensagem: msg || "Senha incorreta." };
  if (res.status === 404) return { tipo: "indisponivel" };
  if (res.status === 429) return { tipo: "limite", mensagem: msg || "Muitas tentativas. Aguarde alguns minutos e tente de novo." };
  if (res.status === 400 || res.status === 413) return { tipo: "invalido", mensagem: msg || "Confira os dados e tente de novo." };
  return { tipo: "falha", mensagem: "Não foi possível carregar agora. Tente de novo em instantes." };
}

export const portalCarregar = (token: string, senha?: string) => chamar<DadosPortal | SenhaObrigatoria>(token, { senha });

export const portalVerificar = (token: string, senha: string) =>
  chamar<{ ok: true }>(`${token}/verificar`, { method: "POST", corpo: { senha } });

export const portalSolicitar = (token: string, senha: string, tipoId: string, descricao: string) =>
  chamar<{ ok: true }>(`${token}/solicitar`, { method: "POST", senha, corpo: { tipoId, descricao } });

export const chaveSenhaPortal = (token: string) => `denos:portal-senha:${token}`;

// ---------------------------------------------------------------------------
// Formatação (datas do portal: AAAA-MM-DD é data de calendário, sem fuso)
// ---------------------------------------------------------------------------
const FUSO = "America/Sao_Paulo";

/** "AAAA-MM-DD" ou timestamp ISO → "dd/mm/aaaa" (calendário de São Paulo para timestamps). */
export function dataBR(v: string | null | undefined): string {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [a, m, d] = v.split("-");
    return `${d}/${m}/${a}`;
  }
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric" }).format(dt);
}

export function numeroWhatsappLink(numero: string, texto: string): string {
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}
