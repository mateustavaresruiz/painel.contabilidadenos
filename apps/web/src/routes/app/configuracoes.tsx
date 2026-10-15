import { Lock, Settings } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { ConfigGeral } from "@/components/features/configuracoes/geral";
import { ConfigIntegracoes } from "@/components/features/configuracoes/integracoes";
import { ConfigModulos } from "@/components/features/configuracoes/modulos";
import { ConfigSistema } from "@/components/features/configuracoes/sistema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageTitle } from "@/hooks/use-page-title";
import { useEhAdmin, useModulos } from "@/lib/modulos";
import { WhatsappInstanciasSection } from "@/routes/app/inbox-canais";

const ABAS = ["geral", "modulos", "integracoes", "conexoes", "sistema"] as const;
type Aba = (typeof ABAS)[number];

/**
 * Configurações (admin). 🔴 Portão de TELA, não de segurança: sem login,
 * qualquer um pode se escolher como admin no "Quem é você?" (ver
 * lib/modulos.ts). A senha do domínio é a proteção real hoje.
 *
 * Conexões do WhatsApp moram aqui (como no adv3, escritorio?tab=conexoes);
 * /whatsapp/conexoes redireciona para cá.
 */
export function ConfiguracoesPage() {
  usePageTitle("Configurações");
  const ehAdmin = useEhAdmin();
  const { ativo } = useModulos();
  const [params, setParams] = useSearchParams();
  const pedida = params.get("tab") as Aba | null;
  const abas = ABAS.filter((a) => a !== "conexoes" || ativo("whatsapp"));
  const aba: Aba = pedida && abas.includes(pedida) ? pedida : "geral";

  if (!ehAdmin) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <EmptyState
          icon={Lock}
          title="Só para administradores"
          description="As configurações do painel ficam com quem tem papel de administrador na Equipe."
          action={
            <Button asChild variant="outline">
              <Link to="/">Voltar ao início</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        icon={Settings}
        title="Configurações"
        description="Escritório, módulos, integrações e informações para quem mantém o sistema."
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
            <TabsTrigger value="geral">Geral</TabsTrigger>
            <TabsTrigger value="modulos">Módulos</TabsTrigger>
            <TabsTrigger value="integracoes">Integrações</TabsTrigger>
            {ativo("whatsapp") && <TabsTrigger value="conexoes">Conexões WhatsApp</TabsTrigger>}
            <TabsTrigger value="sistema">Sistema</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="geral" className="mt-5">
          <ConfigGeral />
        </TabsContent>
        <TabsContent value="modulos" className="mt-5">
          <ConfigModulos />
        </TabsContent>
        <TabsContent value="integracoes" className="mt-5">
          <ConfigIntegracoes />
        </TabsContent>
        {ativo("whatsapp") && (
          <TabsContent value="conexoes" className="mt-5">
            <WhatsappInstanciasSection ehDono={ehAdmin} />
          </TabsContent>
        )}
        <TabsContent value="sistema" className="mt-5">
          <ConfigSistema />
        </TabsContent>
      </Tabs>
    </div>
  );
}
