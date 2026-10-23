import { PageContainer } from "@/components/page-container";
import { Lock, Settings } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { AuditoriaPainel } from "@/components/features/auditoria/auditoria-painel";
import { ConfigGeral } from "@/components/features/configuracoes/geral";
import { ConfigImportarExportar } from "@/components/features/configuracoes/importar-exportar";
import { ConfigIntegracoes } from "@/components/features/configuracoes/integracoes";
import { ConfigModulos } from "@/components/features/configuracoes/modulos";
import { ConfigSistema } from "@/components/features/configuracoes/sistema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageTitle } from "@/hooks/use-page-title";
import { usePermissao } from "@/lib/colaborador";
import { PERMISSAO_TECNICA } from "@/lib/permissoes";
import { useModulos } from "@/lib/modulos";
import { WhatsappInstanciasSection } from "@/routes/app/inbox-canais";

const ABAS = ["geral", "modulos", "integracoes", "dados", "conexoes", "auditoria", "sistema"] as const;
/** Abas da área técnica: só o cargo Desenvolvedor (sistema.tecnico). */
const ABAS_TECNICAS: readonly Aba[] = ["integracoes", "sistema"];
type Aba = (typeof ABAS)[number];

/**
 * Configurações: as abas do painel exigem configuracoes.gerenciar; a de
 * Conexões, whatsapp.conexoes. O banco e as functions conferem de novo.
 *
 * Conexões do WhatsApp moram aqui (como no adv3, escritorio?tab=conexoes);
 * /whatsapp/conexoes redireciona para cá.
 */
export function ConfiguracoesPage() {
  usePageTitle("Configurações");
  const ehAdmin = usePermissao("configuracoes.gerenciar");
  const tecnico = usePermissao(PERMISSAO_TECNICA);
  const { ativo } = useModulos();
  const conexoes = usePermissao("whatsapp.conexoes") && ativo("whatsapp");
  const auditar = usePermissao("auditoria.ver");
  const [params, setParams] = useSearchParams();
  const pedida = params.get("tab") as Aba | null;
  const abas = ABAS.filter((a) =>
    a === "conexoes" ? conexoes : a === "auditoria" ? auditar : ABAS_TECNICAS.includes(a) ? tecnico : ehAdmin,
  );
  const aba: Aba | undefined = pedida && abas.includes(pedida) ? pedida : abas[0];

  if (!aba) {
    return (
      <PageContainer>
        <EmptyState
          icon={Lock}
          title="Sem acesso"
          description="As configurações do painel ficam com quem tem essa permissão no cargo (Equipe, aba Cargos)."
          action={
            <Button asChild variant="outline">
              <Link to="/">Voltar ao início</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={Settings}
        title="Configurações"
        description={tecnico ? "Escritório, módulos, integrações, importar e exportar dados e informações para quem mantém o sistema." : "Escritório, módulos e importar e exportar dados."}
      />
      <Tabs
        value={aba}
        onValueChange={(v) => {
          const p = new URLSearchParams(params);
          p.set("tab", v);
          setParams(p, { replace: true });
        }}
      >
        <div className="overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList>
            {ehAdmin && <TabsTrigger value="geral">Geral</TabsTrigger>}
            {ehAdmin && <TabsTrigger value="modulos">Módulos</TabsTrigger>}
            {tecnico && <TabsTrigger value="integracoes">Integrações</TabsTrigger>}
            {ehAdmin && <TabsTrigger value="dados">Importar e exportar</TabsTrigger>}
            {conexoes && <TabsTrigger value="conexoes">Conexões WhatsApp</TabsTrigger>}
            {auditar && <TabsTrigger value="auditoria">Auditoria</TabsTrigger>}
            {tecnico && <TabsTrigger value="sistema">Sistema</TabsTrigger>}
          </TabsList>
        </div>
        <TabsContent value="geral" className="mt-5">
          <ConfigGeral />
        </TabsContent>
        <TabsContent value="modulos" className="mt-5">
          <ConfigModulos />
        </TabsContent>
        {tecnico && (
          <TabsContent value="integracoes" className="mt-5">
            <ConfigIntegracoes />
          </TabsContent>
        )}
        <TabsContent value="dados" className="mt-5">
          <ConfigImportarExportar />
        </TabsContent>
        {conexoes && (
          <TabsContent value="conexoes" className="mt-5">
            <WhatsappInstanciasSection ehDono={conexoes} />
          </TabsContent>
        )}
        {auditar && (
          <TabsContent value="auditoria" className="mt-5">
            <AuditoriaPainel />
          </TabsContent>
        )}
        {tecnico && (
          <TabsContent value="sistema" className="mt-5">
            <ConfigSistema />
          </TabsContent>
        )}
      </Tabs>
    </PageContainer>
  );
}
