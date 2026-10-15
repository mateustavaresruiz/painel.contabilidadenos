import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";

import { diasRestantes, statusCertificado } from "@/lib/queries/certificados";
import { cn } from "@/lib/utils";

/** Selo colorido do certificado: vencido / vence em ≤30 dias / em dia. */
export function CertificadoStatusBadge({
  validoAte,
  className,
  comDias = true,
}: {
  validoAte: string;
  className?: string;
  comDias?: boolean;
}) {
  const st = statusCertificado(validoAte);
  const d = diasRestantes(validoAte);
  const Icon = st === "vencido" ? ShieldX : st === "vencendo" ? ShieldAlert : ShieldCheck;
  const texto =
    st === "vencido"
      ? `Vencido${comDias ? ` há ${-d} d` : ""}`
      : st === "vencendo"
        ? d === 0
          ? "Vence hoje"
          : `Vence em ${d} d`
        : comDias
          ? `Em dia · ${d} d`
          : "Em dia";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium",
        st === "vencido" && "bg-destructive/10 text-destructive border-destructive/25",
        st === "vencendo" && "bg-warning/10 text-warning border-warning/30",
        st === "ok" && "bg-success/10 text-success border-success/25",
        className,
      )}
    >
      <Icon className="size-3" />
      {texto}
    </span>
  );
}
