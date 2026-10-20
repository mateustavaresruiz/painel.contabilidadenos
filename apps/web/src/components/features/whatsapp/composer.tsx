import { Loader2, Paperclip, Send, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToque } from "@/hooks/use-media-query";
import { arquivosColados } from "@/lib/clipboard-arquivos";
import { useEu } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { ehConflitoAtendimento } from "@/lib/queries/atendimento";
import { nomeExibicao, useCliente } from "@/lib/queries/clientes";
import {
  filtrarRespostas,
  preencherVariaveis,
  useRespostasRapidas,
  type RespostaRapida,
} from "@/lib/respostas-rapidas";
import { toast } from "@/lib/toast";
import { useEnviarMidia, useEnviarTexto } from "@/lib/queries/whatsapp";
import { cn } from "@/lib/utils";

import { EmojiPicker } from "./emoji-picker";
import { MenuRespostasBarra, RespostasRapidasBotao } from "./respostas-rapidas";
import { VoiceRecorder } from "./voice-recorder";

type Props = {
  sessaoId: string;
  chatId: string;
  /** Mensagem citada (reply) — wamId + preview */
  replyTo?: { wamId: string; texto: string };
  onCancelReply?: () => void;
  /** Texto inicial do campo (ex.: "Parabenizar no WhatsApp" pré-preenche). */
  textoInicial?: string;
  /** Aviso discreto sob o campo (ex.: "Ao enviar, você assume esta conversa."). */
  dica?: string;
  /** Nome do contato (individual) para {nome}/{primeiro_nome} das respostas rápidas. */
  nomeContato?: string | null;
  /** Cliente vinculado à conversa: o nome dele entra quando é PF ou quando o contato não tem nome. */
  clienteId?: string | null;
};

/** Altura máxima do campo de mensagem (~8 linhas). */
const ALTURA_MAX = 200;

/**
 * Ajusta a altura do campo ao texto. Vazio = 1 linha (a altura mínima do CSS),
 * sempre: é o que impede a caixa gigante ao abrir uma conversa. Com texto,
 * mede com height auto e volta à altura atual antes de aplicar a nova, para a
 * transição animar de px para px (a partir de auto ela não anima).
 */
function ajustarAltura(ta: HTMLTextAreaElement) {
  if (!ta.value) {
    ta.style.height = "";
    return;
  }
  if (ta.clientWidth === 0) return; // escondido: medir agora daria lixo
  const antes = ta.offsetHeight;
  ta.style.height = "auto";
  const alvo = Math.min(ta.scrollHeight, ALTURA_MAX);
  if (alvo === antes) {
    ta.style.height = alvo + "px";
    return;
  }
  ta.style.height = antes + "px";
  void ta.offsetHeight; // fixa o ponto de partida da transição
  ta.style.height = alvo + "px";
}

export function Composer({
  sessaoId,
  chatId,
  replyTo,
  onCancelReply,
  textoInicial,
  dica,
  nomeContato,
  clienteId,
}: Props) {
  // 🔴 O Composer é montado com key={chatId} pelo pai: rascunho, anexo e
  // gravação NÃO passam para a próxima conversa (defeito 56 do adv3).
  const [texto, setTexto] = useState(textoInicial ?? "");
  const { eu } = useEu();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [gravando, setGravando] = useState(false);
  // Tipo da mídia que está sendo enviada (upload + envio no WAHA levam ~2s).
  // Enquanto não-nulo, mostramos a trava "Enviando…" e bloqueamos o composer
  // para não disparar dois envios em cima do outro.
  const [enviandoMidia, setEnviandoMidia] = useState<
    "voice" | "image" | "video" | "file" | null
  >(null);
  const inputFileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Última posição do cursor no textarea — usada para inserir o emoji no
  // ponto certo mesmo com o popover aberto (textarea sem foco).
  const caretRef = useRef(0);

  const enviarTexto = useEnviarTexto();
  const enviarMidia = useEnviarMidia();

  // Pendente só para mídia — texto é otimista (msg fantasma vai pro
  // cache na hora), então o botão não precisa travar.
  const isPending = enviarMidia.isPending;

  // Ctrl+V com imagem (print da tela) ou arquivo no clipboard vira anexo, em
  // vez de o print sumir sem nada acontecer. Um por vez, porque o envio é um
  // por vez.
  function handleColar(e: React.ClipboardEvent) {
    // Colar durante a gravação descartava o áudio calado no adv3.
    if (arquivo || enviandoMidia || gravando) return;
    const [file] = arquivosColados(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    setArquivo(file);
    setTexto(""); // anexo e texto não vão juntos
  }

  function handleAnexarClick() {
    inputFileRef.current?.click();
  }

  function pickKind(file: File): "image" | "video" | "voice" | "file" {
    const type = file.type;
    if (type.startsWith("image/")) return "image";
    if (type.startsWith("video/")) return "video";
    if (type.startsWith("audio/")) return "voice";
    return "file";
  }

  function enviar() {
    // Mídia: ainda precisa aguardar upload antes de zerar (file blob).
    if (arquivo) {
      if (enviarMidia.isPending) return;
      const file = arquivo;
      const reply = replyTo?.wamId;
      const kind = pickKind(file);
      setEnviandoMidia(kind);
      // SEM legenda de propósito: anexo e texto NÃO vão juntos. Enquanto há
      // anexo, o campo de texto fica desabilitado, então não há caption.
      enviarMidia.mutate(
        {
          sessaoId,
          chatId,
          kind,
          file,
          replyTo: reply,
          replyToTexto: replyTo?.texto,
        },
        {
          onError: (err) => {
            if (!ehConflitoAtendimento(err)) toast.error("Não foi possível enviar o arquivo: " + msgErro(err));
            // Restaura UI pro user tentar de novo
            setArquivo(file);
          },
          onSettled: () => setEnviandoMidia(null),
        },
      );
      // Otimismo de UI: limpa imediato; restaura se falhar
      setArquivo(null);
      onCancelReply?.();
      return;
    }

    const txt = texto.trim();
    if (!txt) return;

    // Texto: a mutation já é otimista no cache (fantasma) — só
    // disparar fire-and-forget e limpar input imediato.
    enviarTexto.mutate(
      {
        sessaoId,
        chatId,
        texto: txt,
        replyTo: replyTo?.wamId,
        replyToTexto: replyTo?.texto,
        colaborador: eu ? { id: eu.id, nome: eu.nome, cor: eu.cor } : null,
      },
      {
        // A bolha fica na conversa marcada "não enviada", com reenviar.
        onError: (err) => {
          if (!ehConflitoAtendimento(err)) toast.error("Mensagem não enviada: " + msgErro(err));
        },
      },
    );
    setTexto("");
    onCancelReply?.();
  }

  // Nota de voz gravada no próprio composer (microfone). Vai SEM texto —
  // áudio e texto não se misturam, igual ao WhatsApp. Reaproveita o mesmo
  // fluxo de mídia (kind "voice") que o backend manda com convert:true.
  function enviarVoz(file: File) {
    if (enviarMidia.isPending) return;
    const reply = replyTo?.wamId;
    setEnviandoMidia("voice");
    enviarMidia.mutate(
      {
        sessaoId,
        chatId,
        kind: "voice",
        file,
        replyTo: reply,
        replyToTexto: replyTo?.texto,
      },
      {
        onError: (err) => {
          if (!ehConflitoAtendimento(err)) toast.error("Áudio não enviado: " + msgErro(err));
        },
        onSettled: () => setEnviandoMidia(null),
      },
    );
    onCancelReply?.();
  }

  // Insere o emoji na posição atual do cursor (caretRef) e avança o cursor
  // para depois dele, para dar para emendar vários sem reabrir o popover.
  function inserirEmoji(emoji: string) {
    const pos = Math.min(caretRef.current, texto.length);
    setTexto(texto.slice(0, pos) + emoji + texto.slice(pos));
    caretRef.current = pos + emoji.length;
  }

  // --- Respostas rápidas ------------------------------------------------
  // Só INSEREM o texto no campo; a pessoa revisa e envia (nunca envia sozinho).
  const { respostas } = useRespostasRapidas();
  // Nome para {nome}/{primeiro_nome}: cliente PF vinculado (nome de cadastro)
  // > nome do contato no WhatsApp > cliente PJ. Contato sem nome salvo chega
  // com o telefone no lugar: sem letra não conta. Sem nome, a variável some.
  const nomeDoContato = nomeContato && /\p{L}/u.test(nomeContato) ? nomeContato : null;
  const { data: cliente } = useCliente(clienteId ?? null);
  const nomeVariaveis =
    (cliente?.tipo === "PF" ? nomeExibicao(cliente) : null) ||
    nomeDoContato ||
    (cliente ? nomeExibicao(cliente) : null);

  // Atalho "/": com o campo começando por "/termo" (uma linha só), abre o
  // menu filtrando pelo termo. Esc fecha até a barra sair do começo.
  const [barraFechada, setBarraFechada] = useState(false);
  const [ativoBarra, setAtivoBarra] = useState(0);
  const idMenuBarra = useId();
  const termoBarra = /^\/([^\n]*)$/.exec(texto)?.[1];
  const itensBarra =
    termoBarra !== undefined && !barraFechada && !arquivo ? filtrarRespostas(respostas, termoBarra) : [];
  const menuBarraAberto = itensBarra.length > 0;
  const ativoBarraValido = Math.min(ativoBarra, Math.max(itensBarra.length - 1, 0));

  /**
   * Põe a resposta no campo, com as variáveis trocadas. Pelo atalho "/" ela
   * substitui o "/termo"; pelo botão entra na posição do cursor (campo vazio:
   * vira o texto todo). O foco volta ao campo com o cursor depois do texto.
   */
  function inserirResposta(r: RespostaRapida, viaBarra: boolean) {
    const pronto = preencherVariaveis(r.texto, nomeVariaveis);
    let novo: string;
    let cursor: number;
    if (viaBarra || !texto.trim()) {
      novo = pronto;
      cursor = pronto.length;
    } else {
      const pos = Math.min(caretRef.current, texto.length);
      const antes = texto.slice(0, pos);
      const espaco = antes && !/\s$/.test(antes) ? " " : "";
      novo = antes + espaco + pronto + texto.slice(pos);
      cursor = pos + espaco.length + pronto.length;
    }
    setTexto(novo);
    caretRef.current = cursor;
    setBarraFechada(false);
    setAtivoBarra(0);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(cursor, cursor);
    });
  }

  // O campo cresce com o texto até ~8 linhas (no adv3 ficava preso em 36 px,
  // defeito 40).
  useLayoutEffect(() => {
    if (taRef.current) ajustarAltura(taRef.current);
  }, [texto, gravando]);

  // A largura do campo muda sem o texto mudar (abrir/fechar o painel do
  // cliente, trocar de conversa, a lista lateral redimensionar). Medir só na
  // digitação deixava a caixa gigante ao abrir uma conversa: na primeira
  // medição o campo ainda estava estreito e o texto "quebrava" em dezenas de
  // linhas. Refaz a conta toda vez que a largura muda.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta || typeof ResizeObserver === "undefined") return;
    let largura = ta.clientWidth;
    const obs = new ResizeObserver(() => {
      if (ta.clientWidth === largura) return;
      largura = ta.clientWidth;
      ajustarAltura(ta);
    });
    obs.observe(ta);
    return () => obs.disconnect();
  }, []);

  // No toque (celular/tablet) o Enter do teclado virtual quebra linha, como no
  // WhatsApp do aparelho; enviar é só pelo botão. Com teclado físico (desktop),
  // Enter envia e Shift+Enter quebra linha, como sempre.
  const toque = useToque();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    enviar();
  }

  return (
    <form
      onSubmit={handleSubmit}
      onPaste={handleColar}
      className="shrink-0 border-t bg-card/40 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2"
    >
      {replyTo && (
        <div className="flex items-start gap-2 rounded-md bg-muted px-2 py-1.5 text-xs">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground/70 mb-0.5">
              Respondendo
            </p>
            <p className="truncate text-muted-foreground">{replyTo.texto}</p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancelar resposta"
            className="-my-1 -mr-1 grid size-7 toque:size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {arquivo && (
        <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-xs">
          <Paperclip className="size-3.5 text-muted-foreground" />
          <span className="flex-1 truncate">{arquivo.name}</span>
          <span className="text-muted-foreground">
            {(arquivo.size / 1024).toFixed(0)} KB
          </span>
          <button
            type="button"
            onClick={() => setArquivo(null)}
            aria-label="Remover anexo"
            className="-my-1 -mr-1 grid size-7 toque:size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <input
        ref={inputFileRef}
        type="file"
        className="hidden"
        accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setArquivo(f);
            setTexto(""); // anexo e texto não vão juntos
          }
          e.target.value = "";
        }}
      />

      {/* Trava de envio: enquanto a mídia sobe + é enviada no WAHA (~2s), o
          composer inteiro vira uma barra "Enviando…". Evita disparar dois
          envios em sequência e dá o feedback que faltava entre o Enter e a
          mensagem aparecer de fato na conversa. */}
      {enviandoMidia ? (
        <div className="flex items-center gap-2.5 rounded-md bg-muted px-3 min-h-[44px] text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin shrink-0 text-primary" />
          <span>{rotuloEnviando(enviandoMidia)}</span>
        </div>
      ) : (
      <div className="relative flex items-end gap-2">
        {!gravando && menuBarraAberto && (
          <MenuRespostasBarra
            idBase={idMenuBarra}
            itens={itensBarra}
            ativo={ativoBarraValido}
            nome={nomeVariaveis}
            onEscolher={(r) => inserirResposta(r, true)}
            onAtivar={setAtivoBarra}
          />
        )}
        {/* Durante a gravação o composer some — só a barra do gravador
            fica (timer + waveform + cancelar/enviar). Igual ao WhatsApp. */}
        {!gravando && (
          <>
            <EmojiPicker onPick={inserirEmoji} disabled={!!arquivo} />
            <RespostasRapidasBotao
              respostas={respostas}
              nome={nomeVariaveis}
              onEscolher={(r) => inserirResposta(r, false)}
              disabled={!!arquivo}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 toque:size-11"
              onClick={handleAnexarClick}
              title="Anexar arquivo"
              aria-label="Anexar arquivo"
            >
              <Paperclip className="size-4" />
            </Button>

            <Textarea
              ref={taRef}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                caretRef.current =
                  e.target.selectionStart ?? e.target.value.length;
                setAtivoBarra(0);
                // A barra saiu do começo: o próximo "/" volta a abrir o menu.
                if (!e.target.value.startsWith("/")) setBarraFechada(false);
              }}
              onSelect={(e) => {
                caretRef.current = e.currentTarget.selectionStart ?? 0;
              }}
              disabled={!!arquivo}
              placeholder={
                arquivo ? "Remova o anexo para escrever" : "Mensagem…"
              }
              rows={1}
              enterKeyHint={toque ? "enter" : "send"}
              aria-controls={menuBarraAberto ? idMenuBarra : undefined}
              aria-activedescendant={menuBarraAberto ? `${idMenuBarra}-${ativoBarraValido}` : undefined}
              className={cn(
                "flex-1 min-h-9 toque:min-h-11 max-h-[200px] resize-none text-base fino:text-sm transition-[height] duration-150 ease-out motion-reduce:transition-none",
              )}
              onKeyDown={(e) => {
                // Menu do atalho "/" aberto: ↑↓ escolhem, Enter/Tab inserem
                // (no lugar de enviar), Esc fecha.
                if (menuBarraAberto && !e.nativeEvent.isComposing) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const passo = e.key === "ArrowDown" ? 1 : -1;
                    setAtivoBarra(
                      (ativoBarraValido + passo + itensBarra.length) % itensBarra.length,
                    );
                    return;
                  }
                  if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                    e.preventDefault();
                    const r = itensBarra[ativoBarraValido];
                    if (r) inserirResposta(r, true);
                    return;
                  }
                  if (e.key === "Escape") {
                    // Só fecha o menu: não deixa o Esc chegar a quem fecha a conversa.
                    e.preventDefault();
                    e.stopPropagation();
                    setBarraFechada(true);
                    return;
                  }
                }
                // !isComposing: não envia no meio de uma composição de IME /
                // autocorreção (o Enter que confirma o candidato disparava
                // envio prematuro — daí o "Enter esquisito").
                if (
                  !toque &&
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  enviar();
                }
              }}
            />
          </>
        )}

        {/* Com texto ou anexo → botão Enviar. Campo vazio → microfone (que
            ao gravar vira a barra full-width). Nota de voz nunca leva texto,
            então não há conflito entre os dois modos. */}
        {texto.trim() || arquivo ? (
          <Button
            type="submit"
            size="icon"
            aria-label="Enviar mensagem"
            className="size-9 shrink-0 toque:size-11"
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        ) : (
          <VoiceRecorder
            disabled={isPending}
            onSend={enviarVoz}
            onRecordingChange={setGravando}
          />
        )}
      </div>
      )}
      {dica && !enviandoMidia && (
        <p className="px-1 text-2xs text-muted-foreground">{dica}</p>
      )}
    </form>
  );
}

function rotuloEnviando(
  kind: "voice" | "image" | "video" | "file",
): string {
  switch (kind) {
    case "voice":
      return "Enviando áudio…";
    case "image":
      return "Enviando imagem…";
    case "video":
      return "Enviando vídeo…";
    default:
      return "Enviando arquivo…";
  }
}
