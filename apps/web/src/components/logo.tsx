import { useMarca } from "@/lib/modulos";
import { cn } from "@/lib/utils";

/**
 * Marca da NÓS Contabilidade (Contabilidade Denos). Os PNGs vêm do site
 * oficial: `logo.png` (azul, fundo branco) no tema claro e `logo-branco.png`
 * (branco, fundo transparente) no escuro. O ícone hexagonal (`favicon.png`)
 * serve de marca compacta na sidebar recolhida.
 */
export function Logo({ className }: { className?: string }) {
  // Logo enviada em Configurações > Geral (bucket público "marca") vence a NÓS.
  const { data: marca } = useMarca();
  if (marca?.logoUrl) {
    return (
      <span className={cn("inline-flex items-center", className)}>
        <img src={marca.logoUrl} alt={marca.nome} className="h-full w-auto max-w-[200px] object-contain" />
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center", className)}>
      <img
        src="/logo.png"
        alt="NÓS Contabilidade"
        className="h-full w-auto object-contain dark:hidden mix-blend-multiply"
      />
      <img
        src="/logo-branco.png"
        alt="NÓS Contabilidade"
        className="h-full w-auto object-contain hidden dark:block"
      />
    </span>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/favicon.png"
      alt="NÓS Contabilidade"
      className={cn("size-8 object-contain dark:brightness-[2.2] dark:saturate-50", className)}
    />
  );
}
