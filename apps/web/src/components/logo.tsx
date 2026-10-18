import { useMarca } from "@/lib/modulos";
import { cn } from "@/lib/utils";

/**
 * Marca da NÓS Contabilidade (Contabilidade Denos). Os PNGs vêm do site
 * oficial: `logo.png` (azul, fundo branco) no tema claro e `logo-branco.png`
 * (branco, fundo transparente) no escuro. O ícone hexagonal (`favicon.png`)
 * serve de marca compacta na sidebar recolhida.
 */
export function Logo({ className, branca }: { className?: string; /** Sempre a versão branca (menu marinho). */ branca?: boolean }) {
  // Logo enviada em Configurações > Geral (bucket público "marca") vence a NÓS.
  const { data: marca } = useMarca();
  if (marca?.logoUrl) {
    return (
      <span className={cn("inline-flex items-center", className)}>
        <img src={marca.logoUrl} alt={marca.nomeMarca} className="h-full w-auto max-w-[200px] object-contain" />
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center", className)}>
      <img
        src="/logo.png"
        alt="NÓS Contabilidade"
        className={cn("h-full w-auto object-contain", branca ? "hidden" : "dark:hidden mix-blend-multiply")}
      />
      <img
        src="/logo-branco.png"
        alt="NÓS Contabilidade"
        className={cn("h-full w-auto object-contain", branca ? "block" : "hidden dark:block")}
      />
    </span>
  );
}

export function LogoMark({ className, branca }: { className?: string; branca?: boolean }) {
  return (
    <img
      src="/favicon.png"
      alt="NÓS Contabilidade"
      className={cn("size-8 object-contain", branca ? "brightness-0 invert" : "dark:brightness-[2.2] dark:saturate-50", className)}
    />
  );
}
