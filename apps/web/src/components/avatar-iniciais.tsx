import { Building2, UserRound } from "lucide-react";
import type { CSSProperties } from "react";

import { iniciaisDeContato } from "@/lib/iniciais";
import { cn } from "@/lib/utils";

/** FNV-1a: mesmo nome, mesma cor, em qualquer tela e para qualquer pessoa. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Matizes suaves (evita o vermelho puro, que lê como erro). */
const MATIZES = [212, 262, 172, 32, 330, 142, 196, 290, 18, 236];

/** `style` do avatar suave: define `--av-h`; a classe `avatar-suave` (index.css) pinta claro e escuro. */
export function estiloAvatar(semente: string): CSSProperties {
  return { "--av-h": String(MATIZES[hash(semente || "?") % MATIZES.length]) } as CSSProperties;
}

const TAMANHOS = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-11 text-sm",
  xl: "size-14 text-base",
} as const;

/**
 * Iniciais num círculo de cor suave e determinística (pela semente, ou pelo
 * nome). Sem letra no nome, ícone de pessoa (ou de empresa).
 */
export function AvatarIniciais({
  nome,
  semente,
  size = "sm",
  empresa,
  className,
}: {
  nome: string | null | undefined;
  semente?: string;
  size?: keyof typeof TAMANHOS;
  empresa?: boolean;
  className?: string;
}) {
  const ini = iniciaisDeContato(nome);
  const Icone = empresa ? Building2 : UserRound;
  return (
    <span
      className={cn(
        "avatar-suave inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
        TAMANHOS[size],
        className,
      )}
      style={estiloAvatar(semente ?? nome ?? "")}
      aria-hidden
    >
      {ini ?? <Icone className="size-[55%]" />}
    </span>
  );
}
