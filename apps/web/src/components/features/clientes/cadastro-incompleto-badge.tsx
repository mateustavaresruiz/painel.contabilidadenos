import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Selo discreto do cadastro provisório (criado pelo WhatsApp ao abrir um
 * chamado, sem e-mail nem CPF/CNPJ). Some sozinho quando o cadastro ganha um
 * dos dois (gatilho da migration 008).
 */
export function CadastroIncompletoBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="warning"
      className={cn("shrink-0", className)}
      title="Cadastro criado pelo WhatsApp. Falta e-mail ou CPF/CNPJ."
    >
      Cadastro incompleto
    </Badge>
  );
}
