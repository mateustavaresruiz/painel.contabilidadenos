import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { msgErro } from "@/lib/erro";
import {
  MODULOS_PRINCIPAIS,
  SUBFUNCOES,
  useModulos,
  useSalvarModulos,
  type ModuloChave,
} from "@/lib/modulos";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Liga/desliga módulos e funções. Módulo desligado some do menu e a rota
 * mostra "módulo desativado". Os avisos automáticos de certificado também
 * são respeitados pelo servidor (crons/certificados-avisos).
 */
export function ConfigModulos() {
  const { modulos, carregando } = useModulos();
  const salvar = useSalvarModulos();

  function alternar(chave: ModuloChave, valor: boolean) {
    salvar.mutate(
      { ...modulos, [chave]: valor },
      {
        onSuccess: () => toast.success(valor ? "Ligado." : "Desligado."),
        onError: (e) => toast.error("Não foi possível salvar: " + msgErro(e)),
      },
    );
  }

  if (carregando) {
    return (
      <Card>
        <CardContent className="p-6 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6">
          <h2 className="text-title-md">Módulos</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Desligar esconde o módulo do menu para toda a equipe. Nada é apagado: ligar de novo traz tudo de volta.
          </p>
          <ul className="mt-4 divide-y divide-divider">
            {MODULOS_PRINCIPAIS.map((m) => (
              <Linha
                key={m.chave}
                id={`mod-${m.chave}`}
                nome={m.nome}
                descricao={m.descricao}
                checked={modulos[m.chave]}
                onChange={(v) => alternar(m.chave, v)}
                disabled={salvar.isPending}
              />
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h2 className="text-title-md">Funções</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Partes de um módulo. Com o módulo desligado, a função fica desligada junto.
          </p>
          <ul className="mt-4 divide-y divide-divider">
            {SUBFUNCOES.map((s) => {
              const pai = MODULOS_PRINCIPAIS.find((m) => m.chave === s.pai);
              const paiLigado = modulos[s.pai];
              return (
                <Linha
                  key={s.chave}
                  id={`sub-${s.chave}`}
                  nome={s.nome}
                  descricao={paiLigado ? s.descricao : `${s.descricao} (módulo ${pai?.nome} desligado)`}
                  checked={modulos[s.chave] && paiLigado}
                  onChange={(v) => alternar(s.chave, v)}
                  disabled={salvar.isPending || !paiLigado}
                />
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Linha({
  id,
  nome,
  descricao,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  nome: string;
  descricao: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <li className={cn("flex items-center gap-4 py-3", disabled && !checked && "opacity-70")}>
      <label htmlFor={id} className="flex-1 min-w-0 cursor-pointer">
        <span className="block text-sm font-semibold">{nome}</span>
        <span className="block text-xs text-muted-foreground">{descricao}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={nome} />
    </li>
  );
}
