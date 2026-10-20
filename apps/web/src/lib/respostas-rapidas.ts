// Respostas rápidas do WhatsApp (Config 'whatsapp.respostasRapidas'): textos
// prontos que o atendente INSERE no campo de mensagem, revisa e só então envia.
// Nada aqui envia mensagem. Toda a equipe ativa lê; só quem tem
// configuracoes.gerenciar grava (RLS de Config, 005_login.sql). Sem a chave
// gravada, vale a lista padrão abaixo (só no código, nada é gravado).

import { useMemo } from "react";

import { useConfig, useSalvarConfig } from "@/lib/queries/certificados";
import { normalizarBusca } from "@/lib/texto";

export type RespostaRapida = { titulo: string; texto: string };

export const CONFIG_RESPOSTAS_RAPIDAS = "whatsapp.respostasRapidas";

/** Variáveis aceitas no texto (trocadas pelo nome do contato/cliente da conversa). */
export const VARIAVEIS_RESPOSTA = ["{nome}", "{primeiro_nome}"] as const;

export const RESPOSTAS_PADRAO: RespostaRapida[] = [
  { titulo: "Bom dia", texto: "Bom dia, {primeiro_nome}! Tudo bem? Como podemos ajudar?" },
  { titulo: "Recebido", texto: "Recebido, {primeiro_nome}! Obrigado. Vamos conferir e, se faltar algo, avisamos por aqui." },
  { titulo: "Segue a guia", texto: "Olá, {primeiro_nome}! Segue a guia para pagamento. Qualquer dúvida, é só chamar." },
  {
    titulo: "Precisamos do extrato",
    texto: "Olá, {primeiro_nome}! Para fecharmos o mês, precisamos do extrato bancário do período. Pode enviar por aqui, de preferência em PDF?",
  },
  { titulo: "Vamos verificar e retornamos", texto: "Vamos verificar e retornamos em breve, {primeiro_nome}." },
  {
    titulo: "Documento pendente",
    texto: "Olá, {primeiro_nome}! Ainda falta o documento que pedimos. Consegue enviar por aqui quando puder?",
  },
];

/**
 * Valor cru da Config → lista válida. `null` = chave ausente (vale o padrão);
 * lista vazia = a equipe removeu todas de propósito. Itens sem texto saem.
 */
export function normalizarRespostas(valor: unknown): RespostaRapida[] | null {
  if (!Array.isArray(valor)) return null;
  return valor
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    .map((v) => ({
      titulo: typeof v.titulo === "string" ? v.titulo.trim() : "",
      texto: typeof v.texto === "string" ? v.texto.trim() : "",
    }))
    .filter((r) => r.texto.length > 0)
    .map((r) => ({ ...r, titulo: r.titulo || r.texto.slice(0, 40) }));
}

/** Lista em uso (salva ou a padrão). `salvas` = já existe a chave na Config. */
export function useRespostasRapidas() {
  const q = useConfig<unknown>(CONFIG_RESPOSTAS_RAPIDAS, null);
  // Mesma referência enquanto o valor não muda (o composer filtra a cada tecla).
  const salvas = useMemo(() => normalizarRespostas(q.data), [q.data]);
  return {
    respostas: salvas ?? RESPOSTAS_PADRAO,
    salvas: salvas !== null,
    isLoading: q.isLoading,
  };
}

export function useSalvarRespostasRapidas() {
  const salvar = useSalvarConfig();
  return {
    salvar: (lista: RespostaRapida[]) =>
      salvar.mutateAsync([{ chave: CONFIG_RESPOSTAS_RAPIDAS, valor: normalizarRespostas(lista) ?? [] }]),
    pendente: salvar.isPending,
  };
}

/** Filtra pelo título e pelo texto, sem acento. Termo vazio = todas. */
export function filtrarRespostas(respostas: RespostaRapida[], termo: string): RespostaRapida[] {
  const t = normalizarBusca(termo);
  if (!t) return respostas;
  const noTitulo = respostas.filter((r) => normalizarBusca(r.titulo).includes(t));
  const soNoTexto = respostas.filter(
    (r) => !normalizarBusca(r.titulo).includes(t) && normalizarBusca(r.texto).includes(t),
  );
  // Quem casa no título vem antes: é o que a pessoa costuma digitar depois da barra.
  return [...noTitulo, ...soNoTexto];
}

/** "JOÃO DA SILVA" → "João da Silva" (nome todo em maiúsculas fica estranho na saudação). */
function suavizarCaixa(nome: string): string {
  if (nome !== nome.toUpperCase()) return nome;
  const minusculas = new Set(["da", "das", "de", "do", "dos", "e"]);
  return nome
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

/**
 * Troca {nome} e {primeiro_nome}. Sem nome (contato sem nome salvo, só o
 * telefone), a variável some junto com a vírgula/espaço antes dela:
 * "Bom dia, {primeiro_nome}!" → "Bom dia!".
 */
export function preencherVariaveis(texto: string, nome: string | null | undefined): string {
  const limpo = (nome ?? "").trim();
  const temLetra = /\p{L}/u.test(limpo);
  if (!temLetra) {
    const sem = texto.replace(/[,\s]*\{(nome|primeiro_nome)\}/gi, "").replace(/^[,\s]+/, "");
    // "{primeiro_nome}, segue a guia" → "Segue a guia".
    return /^\s*\{(nome|primeiro_nome)\}/i.test(texto) ? sem.charAt(0).toUpperCase() + sem.slice(1) : sem;
  }
  const completo = suavizarCaixa(limpo.replace(/\s+/g, " "));
  const primeiro = completo.split(" ")[0] ?? completo;
  return texto.replace(/\{nome\}/gi, completo).replace(/\{primeiro_nome\}/gi, primeiro);
}
