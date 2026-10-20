/**
 * Lookups públicos brasileiros usados no cadastro de Cliente.
 *  - ViaCEP (correios): endereço por CEP — gratuito, sem chave.
 *  - BrasilAPI (CNPJ): empresa por CNPJ — gratuito, sem chave, melhor disponibilidade
 *    que ReceitaWS no free tier.
 *
 * Tudo client-side; sem dependência de backend.
 */

export type CepInfo = {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  estado: string; // UF
};

import { normalizarDoc, tipoDoc } from "@/lib/masks";

const cepCache = new Map<string, CepInfo | null>();
const cnpjCache = new Map<string, CnpjInfo | null>();

export async function fetchCep(rawCep: string): Promise<CepInfo | null> {
  const cep = rawCep.replace(/\D/g, "");
  if (cep.length !== 8) return null;
  if (cepCache.has(cep)) return cepCache.get(cep) ?? null;

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      erro?: boolean;
      cep?: string;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
    };
    if (data.erro) {
      cepCache.set(cep, null);
      return null;
    }
    const info: CepInfo = {
      cep: data.cep ?? cep,
      logradouro: data.logradouro ?? "",
      bairro: data.bairro ?? "",
      cidade: data.localidade ?? "",
      estado: data.uf ?? "",
    };
    cepCache.set(cep, info);
    return info;
  } catch {
    return null;
  }
}

export type CnpjInfo = {
  cnpj: string;
  razaoSocial: string;
  fantasia: string | null;
  email: string | null;
  telefone: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  situacao: string | null;
  /** Data de abertura (AAAA-MM-DD) — vira o aniversário da empresa. */
  dataAbertura: string | null;
  /** Regime deduzido das opções da Receita (MEI / Simples), quando houver. */
  regime: "MEI" | "Simples Nacional" | null;
};

const cnpjNaoEncontrados = new Set<string>();

/** true se a última consulta deste CNPJ voltou "não encontrado" na Receita (BrasilAPI 404). */
export function cnpjNaoEncontrado(rawCnpj: string): boolean {
  return cnpjNaoEncontrados.has(normalizarDoc(rawCnpj));
}

export async function fetchCnpj(rawCnpj: string): Promise<CnpjInfo | null> {
  // CNPJ alfanumérico vai com as letras; se a BrasilAPI ainda não o conhecer,
  // volta 404 e a tela só avisa (o cadastro segue à mão).
  const cnpj = normalizarDoc(rawCnpj);
  if (tipoDoc(cnpj) !== "PJ") return null;
  if (cnpjCache.has(cnpj)) return cnpjCache.get(cnpj) ?? null;

  try {
    const res = await fetch(
      `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
    );
    if (!res.ok) {
      // 404 = a Receita não tem este CNPJ (a tela avisa); o resto é falha do serviço.
      if (res.status === 404) cnpjNaoEncontrados.add(cnpj);
      cnpjCache.set(cnpj, null);
      return null;
    }
    const d = (await res.json()) as Record<string, unknown>;
    const info: CnpjInfo = {
      cnpj,
      razaoSocial: (d.razao_social as string) ?? "",
      fantasia: (d.nome_fantasia as string) || null,
      email: (d.email as string) || null,
      telefone: (d.ddd_telefone_1 as string) || null,
      cep: ((d.cep as string) ?? "").replace(/\D/g, "") || null,
      logradouro: (d.logradouro as string) || null,
      numero: (d.numero as string) || null,
      complemento: (d.complemento as string) || null,
      bairro: (d.bairro as string) || null,
      cidade: (d.municipio as string) || null,
      estado: (d.uf as string) || null,
      situacao: (d.descricao_situacao_cadastral as string) || null,
      dataAbertura: (d.data_inicio_atividade as string) || null,
      regime: d.opcao_pelo_mei === true
        ? "MEI"
        : d.opcao_pelo_simples === true
          ? "Simples Nacional"
          : null,
    };
    cnpjCache.set(cnpj, info);
    return info;
  } catch {
    return null;
  }
}

/** Normaliza string com apenas dígitos (para comparações/buscas). */
export function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

/** "cpf" (11 dígitos), "cnpj" (14 caracteres, numérico ou alfanumérico) ou null. */
export function isValidDocLength(s: string): "cpf" | "cnpj" | null {
  const t = tipoDoc(s);
  return t === "PF" ? "cpf" : t === "PJ" ? "cnpj" : null;
}
