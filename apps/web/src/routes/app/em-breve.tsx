import { CalendarClock, Check, ChevronLeft, Info } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";

import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePageTitle } from "@/hooks/use-page-title";
import { MODULOS_EM_BREVE, moduloEmBreve } from "@/lib/em-breve";

/**
 * Página de um módulo da fase 2 (lib/em-breve.ts): o que ele vai ter. Nada
 * funciona ainda; é para a dona do escritório ver o caminho e opinar.
 */
export function EmBrevePage() {
  const { modulo } = useParams<{ modulo: string }>();
  const m = moduloEmBreve(modulo);
  usePageTitle(m ? `${m.titulo} (em breve)` : "Em breve");
  if (!m) return <Navigate to="/" replace />;
  const Icone = m.icone;
  const outros = MODULOS_EM_BREVE.filter((x) => x.chave !== m.chave);

  return (
    <PageContainer>
      <PageHeader
        icon={Icone}
        title={m.titulo}
        description={m.resumo}
        topo={
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground max-lg:-my-2.5 max-lg:py-2.5"
          >
            <ChevronLeft className="size-4" />
            Início
          </Link>
        }
      />

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <CalendarClock className="size-3.5" />
              Em breve · fase 2
            </Badge>
            <span className="text-xs text-muted-foreground">Combinado na reunião de 07/10/2026</span>
          </div>
          <div>
            <h2 className="text-title-md">O que vai ter</h2>
            <ul className="mt-3 space-y-2.5">
              {m.funcionalidades.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm">
                  <Check className="size-4 mt-0.5 shrink-0 text-primary" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
          {m.observacoes?.map((o) => (
            <p key={o} className="flex items-start gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
              <Info className="size-4 shrink-0" />
              <span>{o}</span>
            </p>
          ))}
          <p className="text-sm text-muted-foreground">
            A ordem e os detalhes de cada módulo serão definidos com você antes de começar. Se quiser mudar ou
            acrescentar alguma coisa, é só avisar.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="text-title-md">Também na fase 2</h2>
          <ul className="divide-y divide-divider">
            {outros.map((o) => {
              const I = o.icone;
              return (
                <li key={o.chave}>
                  <Link to={`/em-breve/${o.chave}`} className="group flex items-center gap-3 py-3 hover:text-primary">
                    <I className="size-5 shrink-0 text-muted-foreground group-hover:text-primary" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold">{o.titulo}</span>
                      <span className="block text-xs text-muted-foreground">{o.resumo}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Button asChild variant="outline" size="sm">
            <Link to="/">Voltar ao início</Link>
          </Button>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
