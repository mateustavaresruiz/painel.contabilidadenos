// Persistência de mídia do WhatsApp — usado tanto pelo webhook
// (download imediato quando msg chega) quanto pelo endpoint
// `/messages/refetch-media` (re-tentativa sob demanda quando o
// frontend mostra "mídia indisponível").
//
// Fluxo: pega payload da msg do WAHA → se faltar `media.url`/`data`,
// chama `getMessageWithMedia` (downloadMedia=true) → baixa/decoda →
// sobe pro bucket whatsapp-media → retorna o path.

import { supabaseAdmin } from "./supabase.ts";
import * as waha from "./waha.ts";

const BUCKET = "whatsapp-media";

/**
 * Tipo com que o arquivo RECEBIDO é servido pelo Storage. O tipo vem de quem
 * mandou a mensagem: um "boleto.pdf" declarado como text/html (ou um SVG)
 * abriria como página, com script, no domínio do Supabase. Fora desta lista,
 * vira download (application/octet-stream). A coluna mediaMime guarda o
 * original, para a tela escolher o ícone.
 */
const MIME_SERVIDOS = /^(image\/(jpeg|png|gif|webp|heic|heif|bmp)|video\/(mp4|3gpp|quicktime|webm|mpeg)|audio\/[\w.+-]+|application\/pdf|text\/plain|text\/csv)$/;

export function contentTypeSeguro(mime: string | null | undefined): string {
  const m = (mime ?? "").split(";")[0]!.trim().toLowerCase();
  return MIME_SERVIDOS.test(m) ? m : "application/octet-stream";
}

export type PersistedMedia = {
  mediaPath: string | null;
  mediaMime: string | null;
  mediaNomeArquivo: string | null;
  mediaTamanho: number | null;
};

export type PersistMediaArgs = {
  tenantId: string;
  sessaoId: string;
  sessionName: string;
  chatId: string;
  wamId: string;
  /** Payload bruto da msg (webhook) — opcional pra refetch puro. */
  msg?: Record<string, unknown>;
  /** Tipo já inferido pra evitar parse duplicado. */
  msgType?: string;
  /**
   * Timeout (ms) de cada chamada de fallback `getMessageWithMedia`.
   * Documento é baixado inline em base64 pelo WAHA e passa dos 10s —
   * por isso o default é generoso (25s). O webhook (que roda na CHEGADA
   * da msg, antes do WAHA terminar de baixar) passa um valor curto pra
   * não travar/sofrer retry; quem recupera o doc é o refetch sob
   * demanda (abertura do chat / clique em "Tentar de novo").
   */
  fallbackTimeoutMs?: number;
};

/**
 * Extrai o remoteJid (o chat onde o WAHA realmente guardou a msg)
 * embutido no wamId. Formato WAHA: `{fromMe}_{remoteJid}_{id}[_{participant}]`,
 * ex.: `false_138036490834122@lid_9996D0544DFEC41315`.
 *
 * Importa porque o webhook resolve `@lid → @c.us` ANTES de persistir o
 * chatId (pra não duplicar o chat), mas o WAHA continua indexando a msg
 * sob o `@lid` original. Buscar mídia com o chatId resolvido (`@c.us`)
 * faz o `getMessageWithMedia` não achar a msg — e a mídia nunca baixa
 * (bug do boleto PDF "Arquivo indisponível"). Pra grupos e individuais
 * `@c.us`, o 2º segmento já é igual ao chatId, então não muda nada.
 */
function chatIdFromWamId(wamId: string, fallback: string): string {
  const parts = wamId.split("_");
  if (parts.length >= 3 && parts[1].includes("@")) return parts[1];
  return fallback;
}

function guessExt(filename?: string, mime?: string): string {
  if (filename?.includes(".")) {
    return "." + filename.split(".").pop()!.toLowerCase();
  }
  if (!mime) return "";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("ogg") || mime.includes("opus")) return ".ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("pdf")) return ".pdf";
  return "";
}

export async function persistMediaIfAny(
  args: PersistMediaArgs,
): Promise<PersistedMedia> {
  let media = args.msg?.media as
    | {
        url?: string;
        mimetype?: string;
        filename?: string;
        data?: string;
        error?: string | null;
      }
    | undefined;
  const hasMedia =
    (args.msg?.hasMedia as boolean | undefined) ?? !!media;
  const msgType = args.msgType ?? (args.msg?.type as string | undefined);

  // ANTES: bailávamos imediatamente se media.error vinha setado.
  // Mas isso só significa que o download INTERNO do WAHA falhou na
  // primeira tentativa — chamando `getMessageWithMedia(downloadMedia=true)`
  // a gente força o WAHA a tentar de novo, o que costuma resolver
  // (especialmente em figurinhas/imagens, onde o WAHA precisa de uns
  // segundos pra terminar de baixar do servidor do WhatsApp). Logamos
  // o erro mas seguimos pra fallback.
  if (media?.error) {
    console.warn(
      `[persistMediaIfAny] WAHA reportou erro pra mídia wamId=${args.wamId}: ${media.error} — tentando fallback`,
    );
    media = undefined; // força a entrada no bloco de fallback abaixo
  }

  const ehTipoMidia =
    msgType === "sticker" ||
    msgType === "image" ||
    msgType === "video" ||
    msgType === "gif" || // GIF = MP4 (vídeo); baixa igual vídeo
    msgType === "audio" ||
    msgType === "ptt" ||
    msgType === "document";

  // FALLBACK com backoff: webhook às vezes manda hasMedia=true SEM
  // media.url (figurinhas/imagens em algumas engines), OU WAHA ainda
  // tá baixando do servidor do WhatsApp. Tenta até 3x com delays
  // 0/1.5s/4s — cobre o caso "WAHA precisa de uns segundos pra
  // terminar de baixar". Sem retry, msgs que chegam logo após o
  // recebimento ficam sem mídia pra sempre.
  if (ehTipoMidia && (!media || (!media.url && !media.data))) {
    // O WAHA indexa a msg pelo remoteJid embutido no wamId, que pode
    // diferir do chatId persistido (caso @lid → @c.us). Usa o do wamId.
    const wahaChatId = chatIdFromWamId(args.wamId, args.chatId);
    const delays = [0, 1500, 4000];
    // Documento (PDF etc.) chega inline em base64 e o WAHA leva mais que
    // os 10s padrão pra baixar + empacotar — sem timeout maior, toda
    // tentativa expira vazia e o arquivo nunca carrega. Demais tipos
    // (imagem/figurinha) respondem rápido, então 25s não atrasa nada:
    // só morde quando a chamada de fato trava (= documento baixando).
    const fallbackTimeoutMs = args.fallbackTimeoutMs ?? 25_000;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) {
        await new Promise((r) => setTimeout(r, delays[i]));
      }
      try {
        const refetched = await waha.getMessageWithMedia(
          args.sessionName,
          wahaChatId,
          args.wamId,
          fallbackTimeoutMs,
        );
        if (
          refetched.media?.url ||
          refetched.media?.data
        ) {
          // ignora `error` aqui — se tem url/data, dá pra baixar mesmo
          // que o WAHA tenha reportado erro parcial.
          media = refetched.media;
          console.log(
            `[persistMediaIfAny] fallback OK wamId=${args.wamId} tentativa=${i + 1} (${refetched.media.url ? "url" : "data"})`,
          );
          break;
        }
        console.warn(
          `[persistMediaIfAny] fallback vazio wamId=${args.wamId} tentativa=${i + 1}`,
        );
      } catch (err) {
        console.warn(
          `[persistMediaIfAny] fallback getMessageWithMedia falhou wamId=${args.wamId} tentativa=${i + 1}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  if (!hasMedia && !ehTipoMidia) {
    return {
      mediaPath: null,
      mediaMime: null,
      mediaNomeArquivo: null,
      mediaTamanho: null,
    };
  }

  if (!media || (!media.url && !media.data)) {
    if (ehTipoMidia) {
      console.warn(
        `[persistMediaIfAny] msg tipo=${msgType} sem media após fallback wamId=${args.wamId}`,
      );
    }
    return {
      mediaPath: null,
      mediaMime: media?.mimetype ?? null,
      mediaNomeArquivo: media?.filename ?? null,
      mediaTamanho: null,
    };
  }

  const filenameLimpo =
    media.filename && media.filename.trim().toLowerCase() !== "untitled"
      ? media.filename
      : undefined;

  // Sem cota no painel Denos (tenant_quota_has_room é sempre true), então
  // não há conferência de espaço aqui. O teto por arquivo continua
  // (MAX_MEDIA_BYTES, vale pra URL e pra base64).

  try {
    let bytes: Uint8Array;
    let contentType: string;
    if (media.data) {
      bytes = waha.base64ToBytes(media.data);
      contentType = media.mimetype ?? "application/octet-stream";
    } else {
      const dl = await waha.downloadMedia(media.url!);
      bytes = dl.bytes;
      contentType = dl.contentType;
    }
    const ext = guessExt(filenameLimpo, media.mimetype ?? contentType);
    const chatSafe = args.chatId.replace(/[@.:]/g, "_");
    const wamSafe = args.wamId.replace(/[@.:/]/g, "_");
    // Caminho por INSTÂNCIA e CONVERSA (não por cliente, como no adv3): é o
    // que deixa apagar/limpar uma conversa ou uma instância remover só os
    // arquivos dela, por prefixo (defeito 13 do guia).
    const path = `${args.tenantId}/whatsapp/${args.sessaoId}/${chatSafe}/${wamSafe}${ext}`;
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: contentTypeSeguro(media.mimetype ?? contentType),
        upsert: true,
      });
    if (error) {
      console.warn("[persistMediaIfAny] upload mídia falhou", error.message);
      return {
        mediaPath: null,
        mediaMime: media.mimetype ?? null,
        mediaNomeArquivo: filenameLimpo ?? null,
        mediaTamanho: null,
      };
    }
    return {
      mediaPath: path,
      mediaMime: media.mimetype ?? contentType,
      mediaNomeArquivo: filenameLimpo ?? null,
      mediaTamanho: bytes.byteLength,
    };
  } catch (err) {
    if (err instanceof waha.MediaTooLargeError) {
      console.warn(
        `[persistMediaIfAny] mídia descartada por exceder ${waha.MAX_MEDIA_BYTES} bytes`,
        err.size,
        err.url,
      );
      return {
        mediaPath: null,
        mediaMime: media.mimetype ?? null,
        mediaNomeArquivo: filenameLimpo ?? null,
        mediaTamanho: err.size,
      };
    }
    console.warn("[persistMediaIfAny] download mídia falhou", err);
    return {
      mediaPath: null,
      mediaMime: media.mimetype ?? null,
      mediaNomeArquivo: media.filename ?? null,
      mediaTamanho: null,
    };
  }
}
