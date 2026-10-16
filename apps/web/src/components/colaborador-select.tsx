import { ColaboradorAvatar, SemResponsavelAvatar } from "@/components/colaborador-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QueryError } from "@/components/ui/query-error";
import { useColaboradores } from "@/lib/colaborador";

const NENHUM = "__nenhum__";

/**
 * Seletor de colaborador (ativos) com as iniciais coloridas. `value` null =
 * "ninguém" (só aparece quando `rotuloNenhum` é passado).
 */
export function ColaboradorSelect({
  value,
  onChange,
  rotuloNenhum,
  excluirIds,
  id,
  placeholder = "Escolha um colaborador",
  className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  rotuloNenhum?: string;
  excluirIds?: string[];
  id?: string;
  placeholder?: string;
  className?: string;
}) {
  const { data = [], isError, error, refetch } = useColaboradores();
  const lista = data.filter((c) => (c.ativo || c.id === value) && !excluirIds?.includes(c.id));
  if (isError && data.length === 0) {
    return <QueryError compacto oque="a equipe" error={error} onRetry={refetch} className={className} />;
  }
  return (
    <Select
      value={value ?? (rotuloNenhum ? NENHUM : undefined)}
      onValueChange={(v) => onChange(v === NENHUM ? null : v)}
    >
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {rotuloNenhum && (
          <SelectItem value={NENHUM}>
            <span className="inline-flex items-center gap-2">
              <SemResponsavelAvatar size="2xs" />
              {rotuloNenhum}
            </span>
          </SelectItem>
        )}
        {lista.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="inline-flex items-center gap-2">
              <ColaboradorAvatar nome={c.nome} cor={c.cor} size="2xs" />
              {c.nome}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
