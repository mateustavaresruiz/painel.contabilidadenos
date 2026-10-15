// Foto da instância de WhatsApp — a que identifica o número DENTRO do adv3
// (tela de Canais e seletor de instância no inbox).
//
// 🔴 É foto interna. Trocar aqui NÃO mexe no perfil do WhatsApp: os clientes
// do escritório continuam vendo a mesma foto de sempre. O backend só LÊ o
// perfil do WAHA (`getMyProfile`) — não existe rota pra escrever nele, e não
// deve passar a existir sem o dono pedir.

import { Camera, Loader2, RotateCcw, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  mediaSignedUrl,
  useRemoverFotoSessao,
  useTrocarFotoSessao,
  type WhatsappSessao,
} from "@/lib/queries/whatsapp";

const LADO_MAX = 512;
const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/webp"];

/** Iniciais de fallback: 2 últimos dígitos do número, ou 2 letras do apelido. */
function iniciaisDe(sessao: WhatsappSessao): string {
  const label = sessao.apelido ?? sessao.numero ?? "?";
  return label.replace(/\D/g, "").slice(-2) || label.slice(0, 2).toUpperCase();
}

/**
 * Reduz a imagem pra no máximo 512px de lado e devolve um data URL JPEG.
 * Sem isso, a foto de 6 MB do celular estoura o limite de 2 MB da rota.
 */
async function paraDataUrlReduzido(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não consegui processar a imagem.");
  ctx.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.9);
}

/** Resolve a URL assinada do avatar da sessão (null = mostrar iniciais). */
function useFotoUrl(fotoPath: string | null): string | null {
  const path = fotoPath && fotoPath !== "__none__" ? fotoPath : null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let cancelado = false;
    mediaSignedUrl(path).then((u) => {
      if (!cancelado) setUrl(u);
    });
    return () => {
      cancelado = true;
    };
  }, [path]);
  return url;
}

/**
 * Avatar da instância. Só o dono vê o botão de trocar — a rota do backend
 * também é owner-only, então esconder aqui é conveniência, não a trava.
 */
export function FotoInstancia({
  sessao,
  ehDono,
}: {
  sessao: WhatsappSessao;
  ehDono: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const url = useFotoUrl(sessao.fotoPath);

  const conteudo = url ? (
    <img src={url} alt="" className="size-full object-cover" />
  ) : (
    <span className="text-sm font-semibold">{iniciaisDe(sessao)}</span>
  );

  if (!ehDono) {
    return (
      <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-border/40 bg-primary/10 text-primary">
        {conteudo}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Trocar a foto desta instância (só aparece aqui dentro)"
        className={cn(
          "group relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg",
          "border border-border/40 bg-primary/10 text-primary",
          "transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        {conteudo}
        <span className="absolute inset-0 hidden place-items-center bg-foreground/60 text-background group-hover:grid">
          <Camera className="size-4" />
        </span>
      </button>
      <FotoInstanciaDialog
        sessao={sessao}
        open={aberto}
        onOpenChange={setAberto}
        urlAtual={url}
      />
    </>
  );
}

function FotoInstanciaDialog({
  sessao,
  open,
  onOpenChange,
  urlAtual,
}: {
  sessao: WhatsappSessao;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  urlAtual: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const trocar = useTrocarFotoSessao(sessao.id);
  const remover = useRemoverFotoSessao(sessao.id);
  const ocupado = trocar.isPending || remover.isPending;

  async function handleArquivo(file: File | undefined) {
    if (!file) return;
    if (!TIPOS_ACEITOS.includes(file.type)) {
      toast.error("Use uma imagem JPG, PNG ou WEBP.");
      return;
    }
    try {
      const dataUrl = await paraDataUrlReduzido(file);
      await trocar.mutateAsync(dataUrl);
      toast.info("Foto trocada. Ela vale só aqui no painel.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRestaurar() {
    try {
      await remover.mutateAsync();
      toast.success("Voltou pra foto do WhatsApp.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Foto da instância</DialogTitle>
          <DialogDescription>
            Serve pra você identificar {sessao.apelido ?? "este número"} dentro
            do painel. <span className="font-medium text-foreground">
              O perfil do WhatsApp não muda:
            </span>{" "}
            seus clientes continuam vendo a foto de sempre.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4">
          <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border bg-primary/10 text-primary">
            {urlAtual ? (
              <img src={urlAtual} alt="" className="size-full object-cover" />
            ) : (
              <span className="text-xl font-semibold">
                {iniciaisDe(sessao)}
              </span>
            )}
          </div>
          <div className="min-w-0 text-sm">
            <p className="font-medium truncate">
              {sessao.apelido ?? "WhatsApp"}
            </p>
            <p className="text-xs text-muted-foreground">
              {sessao.fotoPersonalizada
                ? "Foto personalizada (só no painel)"
                : "Foto vinda do WhatsApp"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              JPG, PNG ou WEBP. Redimensiono pra 512px.
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={TIPOS_ACEITOS.join(",")}
          className="hidden"
          onChange={(e) => void handleArquivo(e.target.files?.[0])}
        />

        <DialogFooter className="gap-2 sm:justify-between">
          {sessao.fotoPersonalizada ? (
            <Button
              variant="ghost"
              onClick={handleRestaurar}
              disabled={ocupado}
            >
              {remover.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              Usar a foto do WhatsApp
            </Button>
          ) : (
            <span />
          )}
          <Button
            onClick={() => inputRef.current?.click()}
            disabled={ocupado}
          >
            {trocar.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            Escolher imagem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
