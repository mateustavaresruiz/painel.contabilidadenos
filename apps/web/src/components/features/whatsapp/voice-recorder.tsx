import { Loader2, Mic, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  /** Bloqueia o microfone enquanto há outro envio em andamento. */
  disabled?: boolean;
  /** Recebe o áudio gravado pronto pra enviar como nota de voz. */
  onSend: (file: File) => void;
  /** Avisa o composer pra esconder o campo de texto durante a gravação. */
  onRecordingChange?: (recording: boolean) => void;
};

// Quantas barras desenhamos no visualizador. Valor "estético" — o suficiente
// pra dar a sensação de waveform sem custar caro no rAF.
const NUM_BARRAS = 28;

/**
 * Gravador de áudio estilo WhatsApp pra notas de voz. Segura o microfone,
 * mostra timer + waveform reagindo ao volume, e oferece cancelar (lixeira)
 * ou enviar. Nota de voz NÃO leva texto — é só o áudio.
 *
 * O blob sai em `audio/webm;codecs=opus` (ou o que o browser suportar); o
 * backend manda com `convert: true`, então o WAHA transcodifica pra opus
 * que o WhatsApp aceita em voice note.
 */
export function VoiceRecorder({ disabled, onSend, onRecordingChange }: Props) {
  const [gravando, setGravando] = useState(false);
  // "iniciando" cobre a janela entre o clique e o getUserMedia resolver —
  // evita duplo-clique abrir dois streams.
  const [iniciando, setIniciando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  // Níveis de volume normalizados (0..1) das últimas amostras, pra waveform.
  const [niveis, setNiveis] = useState<number[]>(() =>
    Array(NUM_BARRAS).fill(0.08),
  );

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Quando o usuário cancela, marcamos pra descartar o blob no onstop em vez
  // de enviar (o onstop dispara de qualquer jeito ao parar o recorder).
  const cancelarRef = useRef(false);

  // Libera tudo: tracks do microfone, AudioContext, timer e rAF. Idempotente.
  const limpar = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  // Garante a limpeza se o componente desmontar no meio de uma gravação
  // (ex.: usuário troca de conversa).
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        cancelarRef.current = true;
        mediaRecorderRef.current.stop();
      }
      limpar();
    };
  }, [limpar]);

  // Mantém o composer em sincronia com o estado de gravação (esconde o
  // textarea enquanto grava).
  useEffect(() => {
    onRecordingChange?.(gravando);
  }, [gravando, onRecordingChange]);

  // Loop de análise de volume → atualiza o array de níveis (efeito waveform).
  const animarNiveis = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(buf);
    // RMS em torno de 128 (silêncio) → amplitude 0..1.
    let soma = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i]! - 128) / 128;
      soma += v * v;
    }
    const rms = Math.sqrt(soma / buf.length);
    const nivel = Math.min(1, Math.max(0.08, rms * 3));
    setNiveis((prev) => [...prev.slice(1), nivel]);
    rafRef.current = requestAnimationFrame(animarNiveis);
  }, []);

  async function iniciar() {
    if (disabled || iniciando || gravando) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Seu navegador não permite gravar áudio.");
      return;
    }
    setIniciando(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Escolhe o melhor container suportado. Safari não tem webm/opus —
      // cai pra mp4/aac, que o WAHA também transcodifica.
      const candidatos = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const mimeType =
        candidatos.find((m) => MediaRecorder.isTypeSupported(m)) || "";

      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      cancelarRef.current = false;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const tipo = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: tipo });
        chunksRef.current = [];
        limpar();
        setGravando(false);
        setSegundos(0);
        setNiveis(Array(NUM_BARRAS).fill(0.08));
        if (cancelarRef.current) return; // descarta
        if (blob.size === 0) return;
        const ext = tipo.includes("mp4")
          ? "m4a"
          : tipo.includes("ogg")
            ? "ogg"
            : "webm";
        const file = new File([blob], `audio-${Date.now()}.${ext}`, {
          type: tipo,
        });
        onSend(file);
      };

      // Visualizador de volume.
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;
      rafRef.current = requestAnimationFrame(animarNiveis);

      recorder.start();
      setGravando(true);
      setSegundos(0);
      timerRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    } catch (err) {
      limpar();
      // NotAllowedError = usuário negou; o resto cai no genérico.
      const negou =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
      toast.error(
        negou
          ? "Permita o acesso ao microfone pra gravar áudio."
          : "Não foi possível acessar o microfone.",
      );
    } finally {
      setIniciando(false);
    }
  }

  function parar() {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state !== "recording") return;
    cancelarRef.current = false;
    rec.stop(); // onstop monta o blob e chama onSend
  }

  function cancelar() {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state !== "recording") {
      // Nada pra parar — só garante limpeza/estado.
      limpar();
      setGravando(false);
      setSegundos(0);
      setNiveis(Array(NUM_BARRAS).fill(0.08));
      return;
    }
    cancelarRef.current = true;
    rec.stop();
  }

  if (!gravando) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 shrink-0 toque:size-11"
        onClick={iniciar}
        disabled={disabled || iniciando}
        title="Gravar áudio"
        aria-label="Gravar áudio"
      >
        {iniciando ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Mic className="size-4" />
        )}
      </Button>
    );
  }

  return (
    <div className="flex-1 flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 min-h-9">
      {/* Lixeira — cancela e descarta */}
      <button
        type="button"
        onClick={cancelar}
        className="grid place-items-center size-8 toque:size-11 shrink-0 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
        aria-label="Cancelar gravação"
        title="Cancelar"
      >
        <Trash2 className="size-4" />
      </button>

      {/* Ponto pulsante + timer */}
      <span className="flex items-center gap-1.5 shrink-0 tabular-nums text-xs font-medium text-foreground/80">
        <span className="size-2 rounded-full bg-foreground animate-pulse" />
        {formatTempo(segundos)}
      </span>

      {/* Waveform reagindo ao volume */}
      <div className="flex-1 flex items-center justify-center gap-0.5 h-6 overflow-hidden">
        {niveis.map((n, i) => (
          <span
            key={i}
            className={cn(
              "w-0.5 rounded-full bg-primary/60",
              "transition-[height] duration-75",
            )}
            style={{ height: `${Math.round(n * 100)}%` }}
          />
        ))}
      </div>

      {/* Enviar */}
      <Button
        type="button"
        size="icon"
        className="size-8 shrink-0 toque:size-11"
        onClick={parar}
        title="Enviar áudio"
        aria-label="Enviar áudio"
      >
        <Send className="size-4" />
      </Button>
    </div>
  );
}

function formatTempo(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
