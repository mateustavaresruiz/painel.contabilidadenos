import { Badge } from "@/components/ui/badge";
import type { Estado } from "@/lib/queries/saude";

const VARIANTE = {
  ok: "success",
  atencao: "warning",
  erro: "destructive",
  carregando: "secondary",
} as const;

const ROTULO: Record<Estado, string> = {
  ok: "Funcionando",
  atencao: "Atenção",
  erro: "Com erro",
  carregando: "Verificando",
};

/** Status de integração como badge (DESIGN.md: status nunca é botão colorido). */
export function EstadoBadge({ estado, rotulo }: { estado: Estado; rotulo?: string }) {
  return <Badge variant={VARIANTE[estado]}>{rotulo ?? ROTULO[estado]}</Badge>;
}
