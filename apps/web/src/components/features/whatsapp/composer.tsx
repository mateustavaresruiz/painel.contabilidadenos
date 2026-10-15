import { Loader2, Paperclip, Send, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { arquivosColados } from "@/lib/clipboard-arquivos";
import { useEu } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { toast } from "@/lib/toast";
import { useEnviarMidia, useEnviarTexto } from "@/lib/queries/whatsapp";
import { cn } from "@/lib/utils";

import { EmojiPicker } from "./emoji-picker";
import { VoiceRecorder } from "./voice-recorder";

type Props = {
  sessaoId: string;
  chatId: string;
  /** Mensagem citada (reply) — wamId + preview */
  replyTo?: { wamId: string; texto: string };
  onCancelReply?: () => void;
  /** Texto inicial do campo (ex.: "Parabenizar no WhatsApp" pré-preenche). */
  textoInicial?: string;
};

export function Composer({
  sessaoId,
  chatId,
  replyTo,
  onCancelReply,
  textoInicial,
}: Props) {
  // 🔴 O Composer é montado com key={chatId} pelo pai: rascunho, anexo e
  // gravação NÃO passam para a próxima conversa (defeito 56 do adv3).
  const [texto, setTexto] = useState(textoInicial ?? "");
  const { eu } = useEu();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [gravando, setGravando] = useState(false);
  // Tipo da mídia que está sendo enviada (upload + envio no WAHA levam ~2s).
  // Enquanto não-nulo, mostramos a trava "Enviando…" e bloqueamos o composer
  // pra não disparar dois envios em cima do outro.
  const [enviandoMidia, setEnviandoMidia] = useState<
    "voice" | "image" | "video" | "file" | null
  >(null);
  const inputFileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Última posição do cursor no textarea — usada pra inserir o emoji no
  // ponto certo mesmo com o popover aberto (textarea sem foco).
  const caretRef = useRef(0);

  const enviarTexto = useEnviarTexto();
  const enviarMidia = useEnviarMidia();

  // Pendente só pra mídia — texto é otimista (msg fantasma vai pro
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
            toast.error("Não foi possível enviar o arquivo: " + msgErro(err));
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
        onError: (err) => toast.error("Mensagem não enviada: " + msgErro(err)),
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
        onError: (err) => toast.error("Áudio não enviado: " + msgErro(err)),
        onSettled: () => setEnviandoMidia(null),
      },
    );
    onCancelReply?.();
  }

  // Insere o emoji na posição atual do cursor (caretRef) e avança o cursor
  // pra depois dele, pra dar pra emendar vários sem reabrir o popover.
  function inserirEmoji(emoji: string) {
    const pos = Math.min(caretRef.current, texto.length);
    setTexto(texto.slice(0, pos) + emoji + texto.slice(pos));
    caretRef.current = pos + emoji.length;
  }

  // O campo cresce com o texto até ~8 linhas (no adv3 ficava preso em 36 px,
  // defeito 40).
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [texto, gravando]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    enviar();
  }

  return (
    <form
      onSubmit={handleSubmit}
      onPaste={handleColar}
      className="shrink-0 border-t barra-fixa p-3 space-y-2"
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
            className="text-muted-foreground hover:text-foreground"
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
            className="text-muted-foreground hover:text-foreground"
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
      <div className="flex items-end gap-2">
        {/* Durante a gravação o composer some — só a barra do gravador
            fica (timer + waveform + cancelar/enviar). Igual ao WhatsApp. */}
        {!gravando && (
          <>
            <EmojiPicker onPick={inserirEmoji} disabled={!!arquivo} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0"
              onClick={handleAnexarClick}
              title="Anexar arquivo"
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
              }}
              onSelect={(e) => {
                caretRef.current = e.currentTarget.selectionStart ?? 0;
              }}
              disabled={!!arquivo}
              placeholder={
                arquivo ? "Remova o anexo pra escrever" : "Mensagem…"
              }
              rows={1}
              className={cn("flex-1 min-h-9 max-h-[200px] resize-none text-base md:text-sm")}
              onKeyDown={(e) => {
                // !isComposing: não envia no meio de uma composição de IME /
                // autocorreção (o Enter que confirma o candidato disparava
                // envio prematuro — daí o "Enter esquisito").
                if (
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
            className="size-9 shrink-0"
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
