import { Check, ChevronDown, Plus, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { iniciaisDeContato } from "@/lib/iniciais";
import { cn } from "@/lib/utils";
import { mediaSignedUrl, type WhatsappSessao } from "@/lib/queries/whatsapp";

type Props = {
  sessoes: WhatsappSessao[];
  /** IDs selecionadas. Vazio = "todas". */
  selecionadas: string[];
  onChange: (selecionadas: string[]) => void;
};

/**
 * Card no topo da sidebar mostrando a(s) instância(s) ativa(s).
 *
 *   - 1 sessão → exibe ela com status pulse, dropdown abre só pra
 *     mostrar info (com link "adicionar instância").
 *   - 2+ sessões → multi-select com checkboxes. "Todas" no topo.
 *     Default = todas (Set vazio = todas).
 *
 * Mostra avatar/iniciais da instância, apelido, número formatado,
 * status pulse dot. Pillzinho com contagem se múltiplas selecionadas.
 */
export function InstanceFilterBar({
  sessoes,
  selecionadas,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);

  // Set vazio significa "todas" — quando o usuário desmarca todas, volta
  // a esse estado pra não ficar com filtro impossível ("nenhuma").
  const todas = selecionadas.length === 0 || selecionadas.length === sessoes.length;
  const visiveis = todas ? sessoes : sessoes.filter((s) => selecionadas.includes(s.id));

  // Status agregado: prioriza WORKING. Senão FAILED. Senão STOPPED.
  const statusAgregado: WhatsappSessao["status"] =
    visiveis.find((s) => s.status === "WORKING")?.status ??
    visiveis.find((s) => s.status === "FAILED")?.status ??
    visiveis[0]?.status ??
    "STOPPED";

  // Apelido principal pra mostrar no header colapsado
  const principal = visiveis.find((s) => s.status === "WORKING") ?? visiveis[0];

  function toggle(id: string) {
    // Quando "todas" está implícito, clicar em uma única deve isolar essa.
    if (todas) {
      onChange([id]);
      return;
    }
    if (selecionadas.includes(id)) {
      const novo = selecionadas.filter((x) => x !== id);
      // Se desmarcou todas, volta pra "todas" em vez de filtro vazio.
      onChange(novo.length === 0 ? [] : novo);
    } else {
      onChange([...selecionadas, id]);
    }
  }

  function marcarTodas() {
    onChange([]); // [] = todas
    setOpen(false);
  }

  return (
    <div className="px-3 pt-3 pb-2 shrink-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg",
              "border border-border/60 bg-card hover:bg-accent/40 transition-colors text-left",
              "shadow-sm",
            )}
          >
            <InstanceAvatar
              sessao={principal}
              count={todas && sessoes.length > 1 ? sessoes.length : null}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="font-medium text-[13px] truncate leading-tight">
                  {todas && sessoes.length > 1
                    ? "Todas as instâncias"
                    : (principal?.apelido ??
                       formatNumero(principal?.numero) ??
                       "WhatsApp")}
                </p>
                {/* Pill de contagem quando filtrado pra > 1 explicitamente */}
                {!todas && selecionadas.length > 1 && (
                  <span className="text-[9px] font-medium bg-foreground/[0.06] text-foreground rounded-full px-1.5 py-0.5 leading-none">
                    {selecionadas.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <StatusDot status={statusAgregado} />
                <p className="text-[10.5px] text-muted-foreground truncate leading-tight">
                  {todas && sessoes.length > 1
                    ? `${sessoes.filter((s) => s.status === "WORKING").length} de ${sessoes.length} conectadas`
                    : `${labelStatus(statusAgregado)}${principal?.numero ? ` · ${formatNumero(principal.numero)}` : ""}`}
                </p>
              </div>
            </div>
            <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[300px] p-1.5">
          <p className="text-2xs uppercase tracking-wider text-muted-foreground px-2 pt-1 pb-1.5 font-medium">
            Filtrar por instância
          </p>

          {sessoes.length > 1 && (
            <button
              type="button"
              onClick={marcarTodas}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-2 rounded-md text-left transition-colors hover:bg-accent",
                todas && "bg-accent/60",
              )}
            >
              <div className="size-9 rounded-lg bg-primary/15 text-primary grid place-items-center shrink-0">
                <Radio className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium leading-tight">
                  Todas as instâncias
                </p>
                <p className="text-[10.5px] text-muted-foreground leading-tight mt-0.5">
                  Mostra conversas de todas
                </p>
              </div>
              {todas && <Check className="size-4 text-primary shrink-0" />}
            </button>
          )}

          {sessoes.length > 1 && (
            <div className="my-1 border-t" />
          )}

          {sessoes.map((s) => {
            const ativa = !todas && selecionadas.includes(s.id);
            return (
              <div
                key={s.id}
                className={cn("flex items-center gap-0.5 rounded-md pr-1", ativa && "bg-accent/60")}
              >
                <button
                  type="button"
                  onClick={() => toggle(s.id)}
                  className="flex-1 min-w-0 flex items-center gap-2 px-2 py-2 rounded-md text-left transition-colors hover:bg-accent"
                >
                  <InstanceAvatar sessao={s} count={null} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate leading-tight">
                      {s.apelido ?? formatNumero(s.numero) ?? "WhatsApp"}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <StatusDot status={s.status} />
                      <p className="text-[10.5px] text-muted-foreground truncate leading-tight">
                        {labelStatus(s.status)}
                        {s.numero ? ` · ${formatNumero(s.numero)}` : ""}
                      </p>
                    </div>
                  </div>
                  {ativa && <Check className="size-4 text-primary shrink-0" />}
                </button>
              </div>
            );
          })}

          {(
            <>
              <div className="my-1 border-t" />
              <Link
                to="/configuracoes?tab=conexoes"
                onClick={() => setOpen(false)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Plus className="size-3.5" />
                Adicionar instância
              </Link>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Avatar quadrado pra instância — usa as iniciais do apelido ou do número.
 * Se múltiplas selecionadas, mostra um badge com a contagem.
 */
function InstanceAvatar({
  sessao,
  count,
}: {
  sessao: WhatsappSessao | undefined;
  count: number | null;
}) {
  // Iniciais só de LETRAS do apelido ("Escritório 2" → "ES"); sem apelido,
  // os 2 últimos dígitos do número (no adv3 o apelido virava "2").
  const initials =
    iniciaisDeContato(sessao?.apelido) ??
    ((sessao?.numero ?? "").replace(/\D/g, "").slice(-2) || "?");

  // Foto de perfil da conta conectada (WhatsappSessao.fotoPath, via WAHA /profile).
  const fotoPath = sessao?.fotoPath && sessao.fotoPath !== "__none__" ? sessao.fotoPath : null;
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (count !== null || !fotoPath) {
      setFotoUrl(null);
      return;
    }
    let cancel = false;
    mediaSignedUrl(fotoPath).then((url) => {
      if (!cancel) setFotoUrl(url);
    });
    return () => {
      cancel = true;
    };
  }, [fotoPath, count]);

  return (
    <div className="relative shrink-0">
      <div
        className={cn(
          "size-9 rounded-lg grid place-items-center overflow-hidden text-xs font-bold",
          "bg-muted text-foreground",
          "border border-border/40",
        )}
      >
        {count !== null ? (
          <span className="text-2xs">{count}</span>
        ) : fotoUrl ? (
          <img
            src={fotoUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            onError={() => setFotoUrl(null)}
          />
        ) : (
          initials
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: WhatsappSessao["status"] }) {
  return (
    <span
      className={cn(
        "size-1.5 rounded-full shrink-0",
        status === "WORKING" && "bg-foreground ring-2 ring-foreground/25",
        status === "STARTING" && "bg-foreground animate-pulse",
        status === "SCAN_QR_CODE" && "bg-foreground",
        status === "FAILED" && "bg-destructive",
        status === "STOPPED" && "bg-muted-foreground/40",
      )}
      aria-hidden
    />
  );
}

function labelStatus(s: string): string {
  switch (s) {
    case "WORKING":
      return "Conectado";
    case "STARTING":
      return "Iniciando…";
    case "SCAN_QR_CODE":
      return "Aguardando QR";
    case "FAILED":
      return "Falhou";
    default:
      return "Desconectado";
  }
}

function formatNumero(numero: string | null | undefined): string | null {
  if (!numero) return null;
  const digits = numero.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return numero;
}

/** Util exportado pra reuso no header da conversa. */
export { formatNumero as formatInstanceNumber };
