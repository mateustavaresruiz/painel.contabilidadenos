import type { ReactNode } from "react";

// Regex pra capturar URLs:
//   - http(s)://... — com ou sem caminho
//   - www.foo.com — sem protocolo (prefixo `https://` adicionado ao
//     gerar o href)
//
// Captura tudo de NÃO-whitespace depois do protocolo. Não usa
// lookahead com ponto (.) porque domínios têm pontos internos
// (ex.: `ads.escalezap.com.br/path`) — antes a regex parava no
// primeiro `.` e o usuário via só `https://ads`.
//
// Trailing punctuation comum no fim de uma frase (.,!?;:)]}>"'`) é
// removida depois do match — assim "veja https://foo.com." vira
// link `https://foo.com` + texto `.`.
const URL_REGEX = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAILING_PUNCT_REGEX = /[.,!?;:)\]}>"'`]+$/;
const MENCAO_REGEX = /@(\d{6,})/g;

/**
 * Dado um @<digits> cru, o caller resolve pro nome + chatId real.
 * - `label`  → o que mostrar dentro da bubble (nome do cliente,
 *   pushName ou telefone formatado).
 * - `contatoId` → o `<digits>@c.us` resolvido pra navegar. Null
 *   quando não há contato cacheado — a menção renderiza como texto
 *   simples (sem virar botão clicável).
 */
export type MencaoResolvida = {
  label: string;
  contatoId: string | null;
};

/**
 * Quebra um texto em segmentos misturando strings e elementos `<a>`
 * clicáveis pras URLs encontradas. Detecta `http://`, `https://` e
 * `www.` (esse último ganha o `https://` no href).
 *
 * Renderiza no formato que o React aceita como children: array de
 * `string | ReactElement`. Sem dangerouslySetInnerHTML — texto continua
 * sendo escapado pelo React, só os links viram tags.
 *
 * @example
 *   <p>{renderTextoComLinks("Olha esse https://exemplo.com pra mim")}</p>
 *   // → ["Olha esse ", <a href="https://exemplo.com">https://exemplo.com</a>, " pra mim"]
 */
export function renderTextoComLinks(
  texto: string,
  opts?: { dark?: boolean },
): ReactNode[] {
  const partes: ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_REGEX.exec(texto)) !== null) {
    let url = match[0];
    let trailingPunct = "";
    // Tira pontuação final que provavelmente é da frase, não da URL.
    // Ex.: "vai em https://foo.com." → link `https://foo.com` + texto `.`
    const trailingMatch = url.match(TRAILING_PUNCT_REGEX);
    if (trailingMatch) {
      trailingPunct = trailingMatch[0];
      url = url.slice(0, -trailingPunct.length);
    }
    // Se ficou sem corpo após o protocolo (improvável mas seguro),
    // pula essa correspondência tratando ela como texto puro.
    if (url.length <= 8) {
      // 8 = len("https://"). NÃO mexe em lastIdx: no adv3 isto apagava o
      // texto antes do link curto (defeito 57).
      // Avança 1 char pra não loopar infinito.
      URL_REGEX.lastIndex = match.index + 1;
      continue;
    }

    const start = match.index;
    if (start > lastIdx) {
      partes.push(texto.slice(lastIdx, start));
    }
    const href = url.startsWith("www.") ? `https://${url}` : url;
    partes.push(
      <a
        key={`lnk-${key++}`}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        // Cor adapta ao balão: no balão PRÓPRIO (fundo primary sólido) o
        // link fica claro (primary-foreground); no RECEBIDO (card claro)
        // fica no acento (primary). Sublinhado garante a afordância nos dois.
        // Antes era `text-primary` fixo → sumia (azul no azul) no balão próprio.
        className={`underline underline-offset-2 break-all ${
          opts?.dark
            ? "text-primary hover:text-primary/80"
            : "text-primary hover:text-primary/80"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>,
    );
    if (trailingPunct) {
      partes.push(trailingPunct);
    }
    lastIdx = start + url.length + trailingPunct.length;
  }
  if (lastIdx < texto.length) {
    partes.push(texto.slice(lastIdx));
  }
  // Se não achou nenhum link, retorna o texto inteiro (1 string).
  if (partes.length === 0) return [texto];
  return partes;
}

/**
 * Renderiza o texto de uma mensagem com:
 *   - URLs viraram `<a>` clicável (https://… ou www.…)
 *   - Menções `@<digits>` (LID ou telefone cru que o WhatsApp injeta)
 *     viram `<button>` que abre o chat com aquele contato — quando
 *     o `resolveMencao` consegue mapear pro `<contatoId>@c.us`.
 *
 * Quando o caller não passa `resolveMencao`, o comportamento volta a
 * ser o do `renderTextoComLinks` puro — mantém compatibilidade.
 */
export function renderMensagemTexto(
  texto: string,
  resolveMencao?: (digits: string) => MencaoResolvida | null,
  onMencaoClick?: (contatoId: string) => void,
  opts?: { dark?: boolean },
): ReactNode[] {
  const segmentos = renderTextoComLinks(texto, opts);
  if (!resolveMencao) return segmentos;

  const out: ReactNode[] = [];
  let key = 0;
  for (const seg of segmentos) {
    if (typeof seg !== "string") {
      out.push(seg);
      continue;
    }
    let last = 0;
    MENCAO_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MENCAO_REGEX.exec(seg)) !== null) {
      const digits = m[1]!;
      const info = resolveMencao(digits);
      const before = seg.slice(last, m.index);
      if (before) out.push(before);
      if (info && info.contatoId && onMencaoClick) {
        const contatoId = info.contatoId;
        out.push(
          <button
            key={`mcn-${key++}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMencaoClick(contatoId);
            }}
            className={`font-medium underline underline-offset-2 decoration-dotted hover:decoration-solid cursor-pointer ${
              "hover:text-primary"
            }`}
            title="Abrir conversa"
          >
            @{info.label}
          </button>,
        );
      } else if (info) {
        // Contato sem chatId resolvido — mostra o label legível mas
        // não vira link clicável.
        out.push(`@${info.label}`);
      } else {
        // Nada cacheado — preserva token cru pra não perder informação.
        out.push(m[0]);
      }
      last = m.index + m[0].length;
    }
    const rest = seg.slice(last);
    if (rest) out.push(rest);
  }
  return out;
}

