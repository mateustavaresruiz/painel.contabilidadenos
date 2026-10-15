import { Landmark } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  AgendamentosSerpro,
  ConsultarServicoCard,
  CustosSerpro,
  PainelResumoSerpro,
  ProcuracoesPainel,
} from "@/components/features/serpro/serpro-painel";
import { ConsultasFiscaisLista, SerproStatusCard } from "@/components/features/serpro/serpro-ui";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAlgumaPermissao } from "@/lib/colaborador";

const ABAS = ["painel", "consultar", "procuracoes", "agendamentos", "custos"] as const;
type AbaFiscal = (typeof ABAS)[number];

export function PendenciasFiscaisPage() {
  usePageTitle("Pendências fiscais");
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const t = params.get("tab") as AbaFiscal | null;
  const aba: AbaFiscal = t && ABAS.includes(t) ? t : "painel";
  const veAgenda = useAlgumaPermissao(["serpro.agendar", "serpro.consultar"]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        icon={Landmark}
        title="Pendências fiscais"
        description="Situação fiscal, caixa postal, parcelamentos e procurações pelo Integra Contador do Serpro."
      />

      <SerproStatusCard />

      <Tabs
        value={aba}
        onValueChange={(v) => {
          const p = new URLSearchParams(params);
          if (v === "painel") p.delete("tab");
          else p.set("tab", v);
          setParams(p, { replace: true });
        }}
      >
        <TabsList>
          <TabsTrigger value="painel">Painel</TabsTrigger>
          <TabsTrigger value="consultar">Consultar</TabsTrigger>
          <TabsTrigger value="procuracoes">Procurações</TabsTrigger>
          {veAgenda && <TabsTrigger value="agendamentos">Agendamentos</TabsTrigger>}
          <TabsTrigger value="custos">Custos</TabsTrigger>
        </TabsList>
        <TabsContent value="painel" className="mt-5">
          <PainelResumoSerpro />
        </TabsContent>
        <TabsContent value="consultar" className="mt-5 space-y-6">
          <ConsultarServicoCard clienteId={clienteId} setClienteId={setClienteId} />
          <section className="space-y-3">
            <h2 className="text-title-md">{clienteId ? "Histórico do cliente" : "Últimas consultas"}</h2>
            <ConsultasFiscaisLista clienteId={clienteId ?? undefined} mostrarCliente={!clienteId} />
          </section>
        </TabsContent>
        <TabsContent value="procuracoes" className="mt-5">
          <ProcuracoesPainel />
        </TabsContent>
        {veAgenda && (
          <TabsContent value="agendamentos" className="mt-5">
            <AgendamentosSerpro />
          </TabsContent>
        )}
        <TabsContent value="custos" className="mt-5">
          <CustosSerpro />
        </TabsContent>
      </Tabs>
    </div>
  );
}
