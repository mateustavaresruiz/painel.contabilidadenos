import { lazy, Suspense, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { AuthGate, PermissaoGate } from "@/components/auth-gate";
import { usePageTitle } from "@/hooks/use-page-title";
import { ModuloGate } from "@/components/modulo-gate";
import { AppLayout } from "@/layouts/app-layout";
import type { ModuloChave } from "@/lib/modulos";
import { AuthCallbackPage } from "@/routes/auth/callback";
import { LoginPage } from "@/routes/auth/login";
// Cada página em chunk próprio (o WhatsApp, o maior, não pesa no Início), com
// pré-carga no hover do menu: ver routes/paginas.ts.
import {
  AniversariosPage,
  CertificadosPage,
  ChamadosPage,
  ChatPage,
  ClienteDetalhePage,
  ClientesPage,
  ConfiguracoesPage,
  EditarClientePage,
  EquipePage,
  InicioPage,
  NovoClientePage,
  PendenciasFiscaisPage,
} from "@/routes/paginas";

// Portal do cliente (público): chunk próprio, sem o painel junto.
const PortalPublicoPage = lazy(() => import("@/routes/portal-publico").then((m) => ({ default: m.PortalPublicoPage })));

/** Módulo ligado + permissão do cargo. */
function Pagina({
  modulo,
  permissao,
  children,
}: {
  modulo?: ModuloChave;
  permissao: string | string[];
  children: ReactNode;
}) {
  const conteudo = <PermissaoGate permissao={permissao}>{children}</PermissaoGate>;
  return modulo ? <ModuloGate modulo={modulo}>{conteudo}</ModuloGate> : conteudo;
}

/** Endereço antigo → novo, preservando a querystring (links já salvos). */
function Redireciona({ para }: { para: string }) {
  const { search } = useLocation();
  return <Navigate to={para + search} replace />;
}

function NaoEncontrada() {
  usePageTitle("Página não encontrada");
  return (
    <div className="p-8 space-y-2">
      <h1 className="text-title-lg">Página não encontrada</h1>
      <Link to="/" className="text-sm underline">
        Voltar ao início
      </Link>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="auth/callback" element={<AuthCallbackPage />} />
      {/* Público: link + senha enviados ao cliente. Fora do AuthGate e do menu. */}
      <Route
        path="portal/:token"
        element={
          <Suspense fallback={<div className="min-h-dvh bg-background" />}>
            <PortalPublicoPage />
          </Suspense>
        }
      />
      <Route
        element={
          <AuthGate>
            <AppLayout />
          </AuthGate>
        }
      >
          <Route index element={<InicioPage />} />
          <Route path="whatsapp" element={<Pagina modulo="whatsapp" permissao="whatsapp.ver"><ChatPage /></Pagina>} />
          {/* Conexões moram em Configurações (um lugar só, como no adv3). */}
          <Route path="whatsapp/conexoes" element={<Navigate to="/configuracoes?tab=conexoes" replace />} />
          <Route path="chamados" element={<Pagina modulo="chamados" permissao={["chamados.ver", "chamados.criar", "chamados.gerenciar"]}><ChamadosPage /></Pagina>} />
          <Route path="clientes" element={<Pagina modulo="clientes" permissao="clientes.ver"><ClientesPage /></Pagina>} />
          <Route path="clientes/aniversarios" element={<Pagina modulo="clientes" permissao="aniversarios.ver"><AniversariosPage /></Pagina>} />
          <Route path="clientes/novo" element={<Pagina modulo="clientes" permissao="clientes.editar"><NovoClientePage /></Pagina>} />
          <Route path="clientes/:id" element={<Pagina modulo="clientes" permissao="clientes.ver"><ClienteDetalhePage /></Pagina>} />
          <Route path="clientes/:id/editar" element={<Pagina modulo="clientes" permissao="clientes.editar"><EditarClientePage /></Pagina>} />
          <Route path="certificados" element={<Pagina modulo="certificados" permissao="certificados.ver"><CertificadosPage /></Pagina>} />
          <Route path="pendencias-fiscais" element={<Pagina modulo="pendenciasFiscais" permissao="serpro.consultar"><PendenciasFiscaisPage /></Pagina>} />
          <Route path="equipe" element={<Pagina modulo="equipe" permissao={["equipe.ver", "equipe.gerenciar"]}><EquipePage /></Pagina>} />
          <Route path="configuracoes" element={<Pagina permissao={["configuracoes.gerenciar", "whatsapp.conexoes", "auditoria.ver"]}><ConfiguracoesPage /></Pagina>} />

          <Route path="atendimento" element={<Redireciona para="/whatsapp" />} />
          <Route path="conexoes" element={<Navigate to="/configuracoes?tab=conexoes" replace />} />
          <Route path="solicitacoes" element={<Redireciona para="/chamados" />} />
          <Route path="aniversarios" element={<Redireciona para="/clientes/aniversarios" />} />
          <Route path="colaboradores" element={<Redireciona para="/equipe" />} />

          <Route
            path="*"
            element={<NaoEncontrada />}
          />
      </Route>
    </Routes>
  );
}
