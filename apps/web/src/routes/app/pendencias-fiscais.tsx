import { Landmark } from "lucide-react";
import { useState } from "react";

import { ClienteSelect } from "@/components/features/clientes/cliente-select";
import {
  ConsultarSituacaoBotao,
  ConsultasFiscaisLista,
  SerproStatusCard,
} from "@/components/features/serpro/serpro-ui";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { usePageTitle } from "@/hooks/use-page-title";

export function PendenciasFiscaisPage() {
  usePageTitle("Pendências fiscais");
  const [clienteId, setClienteId] = useState<string | null>(null);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        icon={Landmark}
        title="Pendências fiscais"
        description="Situação fiscal dos clientes na Receita Federal, pelo Integra Contador do Serpro."
      />

      <SerproStatusCard />

      <Card>
        <CardContent className="p-5 space-y-3">
          <h2 className="text-base">Consultar situação fiscal</h2>
          <p className="text-sm text-muted-foreground">
            Escolha o cliente e consulte o relatório de situação fiscal (SITFIS). O resultado fica
            registrado no histórico abaixo e na ficha do cliente.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label>Cliente</Label>
              <ClienteSelect value={clienteId} onChange={setClienteId} />
            </div>
            {clienteId ? (
              <ConsultarSituacaoBotao clienteId={clienteId} size="default" />
            ) : (
              <p className="text-xs text-muted-foreground pb-2">Escolha um cliente para consultar.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-base">{clienteId ? "Histórico do cliente" : "Últimas consultas"}</h2>
        <ConsultasFiscaisLista clienteId={clienteId ?? undefined} mostrarCliente={!clienteId} />
      </section>
    </div>
  );
}
