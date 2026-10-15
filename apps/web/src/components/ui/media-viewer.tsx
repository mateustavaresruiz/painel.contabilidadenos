import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  ImageIcon,
  Loader2,
  Music,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export type MediaKind = "image" | "video" | "audio" | "pdf" | "other";

export type MediaItem = {
  /** Nome do arquivo (usado no header e no download). */
  name?: string | null;
  /** MIME type, se conhecido (ex.: "application/pdf"). */
  mimeType?: string | null;
  /** Tamanho em bytes, se conhecido. */
  size?: number | null;
  /** URL já pronta (pública ou assinada). */
  url?: string | null;
  /** Resolver preguiçoso — chamado só quando o item entra em foco.
   *  Use pra signed URLs do Supabase (mediaSignedUrl / urlAnexo). */
  getUrl?: () => Promise<string | null>;
  /** Sobrescreve a classificação automática por MIME/extensão. */
  kind?: MediaKind;
};

/**
 * Classifica a mídia por MIME type (preferido) ou extensão do nome.
 * Decide qual player/preview o visualizador usa.
 */
export function classifyMedia(
  mimeType?: string | null,
  name?: string | null,
): MediaKind {
  const m = (mimeType ?? "").toLowerCase();
  const ext = (name ?? "").toLowerCase().split(".").pop() ?? "";
  if (
    m.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "heic"].includes(ext)
  )
    return "image";
  if (
    m.startsWith("video/") ||
    ["mp4", "webm", "mov", "m4v", "avi", "mkv", "3gp", "ogv"].includes(ext)
  )
    return "video";
  if (
    m.startsWith("audio/") ||
    ["mp3", "ogg", "oga", "wav", "m4a", "aac", "opus", "amr", "flac"].includes(ext)
  )
    return "audio";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  return "other";
}

function kindOf(item: MediaItem): MediaKind {
  return item.kind ?? classifyMedia(item.mimeType, item.name);
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const u = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function deriveDownloadName(item: MediaItem, src: string): string {
  const nome = (item.name ?? "").trim();
  if (nome && nome.toLowerCase() !== "untitled") return nome;
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  try {
    const last = new URL(src).pathname.split("/").pop() ?? "";
    const ext = last.includes(".") ? "." + last.split(".").pop()! : "";
    return `arquivo-${ts}${ext}`;
  } catch {
    return `arquivo-${ts}`;
  }
}

// ===========================================================================
// Singleton API — monte <MediaViewerProvider /> uma vez (main.tsx) e chame
// openMediaViewer() de qualquer lugar, igual ao confirm-dialog.
// ===========================================================================

let externalOpen: ((items: MediaItem[], index: number) => void) | null = null;

/**
 * Abre o visualizador de mídia da plataforma.
 *
 *   openMediaViewer([{ name, mimeType, getUrl: () => urlAnexo(path) }]);
 *
 * Passe um array pra habilitar navegação por setas (galeria) — útil pra
 * e-mails/conversas com vários anexos. `startIndex` define qual abre.
 */
export function openMediaViewer(items: MediaItem[], startIndex = 0): void {
  const valid = items.filter(Boolean);
  if (valid.length === 0) return;
  // Pausa qualquer vídeo/áudio inline que esteja tocando ANTES de montar o
  // player do viewer (que tem autoPlay). Sem isso, o inline continua tocando
  // e fica som duplicado quando o usuário expande um vídeo já em reprodução.
  if (typeof document !== "undefined") {
    document.querySelectorAll("video, audio").forEach((el) => {
      const m = el as HTMLMediaElement;
      if (!m.paused) m.pause();
    });
  }
  const idx = Math.max(0, Math.min(startIndex, valid.length - 1));
  if (externalOpen) {
    externalOpen(valid, idx);
    return;
  }
  // Fallback se o provider não estiver montado: abre em nova aba.
  const it = valid[idx];
  if (it.url) window.open(it.url, "_blank", "noopener,noreferrer");
  else void it.getUrl?.().then((u) => u && window.open(u, "_blank", "noopener,noreferrer"));
}

/** Hook açúcar — retorna a função de abrir. */
export function useMediaViewer() {
  return openMediaViewer;
}

export function MediaViewerProvider() {
  const [state, setState] = useState<{ items: MediaItem[]; index: number } | null>(
    null,
  );
  useEffect(() => {
    externalOpen = (items, index) => setState({ items, index });
    return () => {
      externalOpen = null;
    };
  }, []);
  if (!state) return null;
  return (
    <MediaViewerOverlay
      items={state.items}
      startIndex={state.index}
      onClose={() => setState(null)}
    />
  );
}

// ===========================================================================
// Overlay
// ===========================================================================

const KIND_ICON: Record<MediaKind, typeof FileText> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  pdf: FileText,
  other: FileText,
};

function MediaViewerOverlay({
  items,
  startIndex,
  onClose,
}: {
  items: MediaItem[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(false);
  // URLs resolvidas por índice (ref + tick pra forçar render sem recriar
  // o efeito de resolução). undefined = carregando, null = falhou.
  const urlsRef = useRef<Record<number, string | null>>({});
  const resolvingRef = useRef<Set<number>>(new Set());
  const [, setTick] = useState(0);

  const multi = items.length > 1;

  const go = useCallback(
    (delta: number) => {
      setZoom(false);
      setIndex((i) => {
        const next = i + delta;
        if (next < 0 || next >= items.length) return i;
        return next;
      });
    },
    [items.length],
  );

  // Teclado: Esc fecha, setas navegam.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, go]);

  // Resolve o item atual + vizinhos (prefetch das signed URLs).
  useEffect(() => {
    const want = [index, index + 1, index - 1].filter(
      (i) => i >= 0 && i < items.length,
    );
    for (const i of want) {
      if (i in urlsRef.current || resolvingRef.current.has(i)) continue;
      const item = items[i];
      if (item.url) {
        urlsRef.current[i] = item.url;
        setTick((t) => t + 1);
        continue;
      }
      if (!item.getUrl) {
        urlsRef.current[i] = null;
        continue;
      }
      resolvingRef.current.add(i);
      void Promise.resolve(item.getUrl())
        .then((u) => {
          urlsRef.current[i] = u ?? null;
        })
        .catch(() => {
          urlsRef.current[i] = null;
        })
        .finally(() => {
          resolvingRef.current.delete(i);
          setTick((t) => t + 1);
        });
    }
  }, [index, items]);

  const item = items[index];
  const kind = kindOf(item);
  const url = urlsRef.current[index];
  const Icon = KIND_ICON[kind];
  const title = item.name?.trim() || "Arquivo";

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex flex-col animate-in fade-in-0 duration-150 backdrop-blur-md"
      // Sem mais o scrim espresso opaco: agora é só um desfoque leve do
      // fundo (backdrop-blur-md) com um véu escuro bem sutil. O véu existe
      // só pra manter o texto branco do header/controles legível por cima
      // de imagens claras — neutro (sem o marrom da marca) pra não tingir
      // o conteúdo. Inline porque os tokens de cor do projeto não têm canal
      // <alpha-value>, então o modificador `/xx` do Tailwind não funciona neles.
      style={{ backgroundColor: "oklch(0.15 0 0 / 0.4)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Visualizar ${title}`}
      onClick={onClose}
    >
      {/* Barra superior */}
      <header
        className="flex items-center gap-3 px-3 sm:px-5 h-14 shrink-0 text-white/90"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="size-9 rounded-lg bg-white/10 grid place-items-center shrink-0">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate text-white">{title}</p>
            <p className="text-2xs text-white/55 truncate">
              {[
                kind === "pdf"
                  ? "PDF"
                  : kind === "other"
                    ? (item.mimeType ?? "Documento")
                    : kind.charAt(0).toUpperCase() + kind.slice(1),
                formatBytes(item.size),
                multi ? `${index + 1} de ${items.length}` : null,
              ]
                .filter(Boolean)
                .join("  ·  ")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* PDF não ganha botão nosso: o leitor nativo do navegador desenha a
              própria barra logo abaixo, com baixar, imprimir e abrir. Dois
              downloads na mesma tela, um em cima do outro, só fazem o usuário
              perguntar qual é o certo. Imagem/vídeo/áudio e o fallback
              "other" não têm barra nenhuma — nesses, os botões ficam. */}
          {url && kind !== "pdf" ? (
            <>
              {kind === "other" && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="grid place-items-center size-9 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                  aria-label="Abrir em nova aba"
                  title="Abrir em nova aba"
                >
                  <ExternalLink className="size-4" />
                </a>
              )}
              <a
                href={url}
                download={deriveDownloadName(item, url)}
                target="_blank"
                rel="noreferrer"
                className="grid place-items-center size-9 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label="Baixar"
                title="Baixar"
              >
                <Download className="size-4" />
              </a>
            </>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="grid place-items-center size-9 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            aria-label="Fechar"
            title="Fechar (Esc)"
          >
            <X className="size-4" />
          </button>
        </div>
      </header>

      {/* Conteúdo */}
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center p-2 sm:p-6"
        onClick={onClose}
      >
        {/* Seta anterior */}
        {multi && index > 0 && (
          <NavButton side="left" onClick={() => go(-1)} />
        )}

        <div
          className="relative max-w-full max-h-full flex items-center justify-center animate-in fade-in-0 zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {url === undefined ? (
            <Loader2 className="size-9 animate-spin text-white/70" />
          ) : url === null ? (
            <UnavailableCard />
          ) : kind === "image" ? (
            <div
              className={cn(
                "max-w-[94vw] max-h-[80vh]",
                zoom && "overflow-auto",
              )}
            >
              <img
                src={url}
                alt={item.name ?? ""}
                onClick={() => setZoom((z) => !z)}
                className={cn(
                  "rounded-lg shadow-2xl select-none",
                  zoom
                    ? "max-w-none max-h-none cursor-zoom-out"
                    : "max-w-[94vw] max-h-[80vh] object-contain cursor-zoom-in",
                )}
              />
            </div>
          ) : kind === "video" ? (
            <video
              src={url}
              controls
              autoPlay
              className="max-w-[94vw] max-h-[82vh] rounded-lg shadow-2xl bg-black"
            />
          ) : kind === "audio" ? (
            <AudioCard url={url} title={title} />
          ) : kind === "pdf" ? (
            <iframe
              title={title}
              src={url}
              className="w-[94vw] h-[82vh] max-w-5xl rounded-lg bg-white shadow-2xl border-0"
            />
          ) : (
            <FilePreviewCard item={item} url={url} />
          )}
        </div>

        {/* Seta próxima */}
        {multi && index < items.length - 1 && (
          <NavButton side="right" onClick={() => go(1)} />
        )}
      </div>
    </div>,
    document.body,
  );
}

function NavButton({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "absolute top-1/2 -translate-y-1/2 z-10 grid place-items-center size-11 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors",
        side === "left" ? "left-2 sm:left-4" : "right-2 sm:right-4",
      )}
      aria-label={side === "left" ? "Anterior" : "Próximo"}
    >
      <Icon className="size-6" />
    </button>
  );
}

function UnavailableCard() {
  return (
    <div className="flex flex-col items-center gap-3 text-center px-8 py-10 rounded-xl bg-white/5 text-white/70">
      <FileText className="size-9" />
      <p className="text-sm">Não foi possível carregar este arquivo.</p>
    </div>
  );
}

function AudioCard({ url, title }: { url: string; title: string }) {
  return (
    <div className="w-[88vw] max-w-md rounded-2xl bg-card text-card-foreground shadow-2xl p-6 flex flex-col items-center gap-5">
      <div className="size-20 rounded-full bg-accent grid place-items-center">
        <Music className="size-9 text-bronze" />
      </div>
      <p className="text-sm font-medium text-center break-words max-w-full px-2">
        {title}
      </p>
      <audio src={url} controls autoPlay className="w-full" />
    </div>
  );
}

function FilePreviewCard({ item, url }: { item: MediaItem; url: string }) {
  return (
    <div className="w-[88vw] max-w-sm rounded-2xl bg-card text-card-foreground shadow-2xl p-7 flex flex-col items-center gap-4 text-center">
      <div className="size-16 rounded-xl bg-accent grid place-items-center">
        <FileText className="size-8 text-bronze" />
      </div>
      <div className="min-w-0 w-full">
        <p className="text-sm font-medium break-words">
          {item.name?.trim() || "Arquivo"}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {[item.mimeType, formatBytes(item.size)].filter(Boolean).join("  ·  ")}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Pré-visualização não disponível para este tipo de arquivo.
      </p>
      <div className="flex items-center gap-2 mt-1">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border hover:bg-accent text-sm font-medium transition-colors"
        >
          <ExternalLink className="size-3.5" />
          Abrir
        </a>
        <a
          href={url}
          download={deriveDownloadName(item, url)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium transition-opacity"
        >
          <Download className="size-3.5" />
          Baixar
        </a>
      </div>
    </div>
  );
}
