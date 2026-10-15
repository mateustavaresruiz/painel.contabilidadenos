import { ExternalLink, RefreshCw, ScrollText } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { msgErro } from "@/lib/erro";
import { formatDataHora } from "@/lib/format";
import { useErrosRecentes } from "@/lib/queries/saude";
import { SUPABASE_URL } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const LINKS = [
  {
    nome: "Supabase Studio",
    url: "https://painel-supabase.at63vf.easypanel.host",
    texto: "Banco, tabelas, storage e SQL. Tem senha própria.",
  },
  {
    nome: "Painel do WAHA",
    url: "https://painel-waha.at63vf.easypanel.host/dashboard",
    texto: "Sessões do WhatsApp direto no servidor.",
  },
  {
    nome: "Easypanel",
    url: "http://187.127.26.230:3000",
    texto: "Serviços, variáveis de ambiente e deploy.",
  },
];

export function ConfigSistema() {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <h2 className="text-title-md">Versão</h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Commit publicado</dt>
              <dd className="font-mono">{__APP_COMMIT__}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Build</dt>
              <dd>{__APP_BUILD_EM__ ? formatDataHora(__APP_BUILD_EM__) : "desconhecido"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Supabase</dt>
              <dd className="font-mono text-xs truncate">{SUPABASE_URL}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="text-title-md">Ferramentas</h2>
          <ul className="divide-y divide-divider">
            {LINKS.map((l) => (
              <li key={l.nome}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 py-3 hover:text-primary"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold">{l.nome}</span>
                    <span className="block text-xs text-muted-foreground">{l.texto}</span>
                    <span className="block text-2xs text-muted-foreground font-mono truncate">{l.url}</span>
                  </span>
                  <ExternalLink className="size-4 text-muted-foreground group-hover:text-primary" />
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <ErrosRecentes />
    </div>
  );
}

function ErrosRecentes() {
  const { data = [], isLoading, error, refetch, isFetching } = useErrosRecentes();
  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h2 className="text-title-md">Log de erros</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Os 50 mais recentes das funções do servidor e das tarefas agendadas. Só leitura.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn(isFetching && "animate-spin")} />
            Atualizar
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Não foi possível ler o log: {msgErro(error)}</p>
        ) : data.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={ScrollText}
            title="Nenhum erro registrado"
            description="Quando uma função falhar, o erro aparece aqui com a rota e o horário."
          />
        ) : (
          <ul className="divide-y divide-divider">
            {data.map((e) => (
              <li key={e.id} className="py-3">
                <details>
                  <summary className="cursor-pointer list-none flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={e.nivel === "error" ? "destructive" : "warning"}>
                      {e.nivel === "error" ? "erro" : "aviso"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatDataHora(e.criadoEm)}</span>
                    <span className="text-xs font-mono text-muted-foreground">
                      {e.origem}
                      {e.rota ? ` ${e.rota}` : ""}
                      {e.status ? ` · ${e.status}` : ""}
                    </span>
                    <span className="basis-full break-words">{e.mensagem}</span>
                  </summary>
                  <div className="mt-2 space-y-2">
                    {e.stack && (
                      <pre className="text-2xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">{e.stack}</pre>
                    )}
                    {e.contexto && Object.keys(e.contexto).length > 0 && (
                      <pre className="text-2xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(e.contexto, null, 2)}
                      </pre>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
