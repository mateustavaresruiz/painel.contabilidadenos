import { lazy, type ComponentType } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { ModuloGate } from "@/components/modulo-gate";
import { QuemSouEuGate } from "@/components/quem-sou-eu";
import { AppLayout } from "@/layouts/app-layout";

// Cada página em chunk próprio: o WhatsApp (o maior) não pesa no Início.
function pagina<T>(imp: () => Promise<T>, nome: keyof T) {
  return lazy(() => imp().then((m) => ({ default: m[nome] as unknown as ComponentType })));
}

const InicioPage = pagina(() => import("@/routes/app/inicio"), "InicioPage");
const ChatPage = pagina(() => import("@/routes/app/chat"), "ChatPage");
const ChamadosPage = pagina(() => import("@/routes/app/chamados"), "ChamadosPage");
const ClientesPage = pagina(() => import("@/routes/app/clientes"), "ClientesPage");
const NovoClientePage = pagina(() => import("@/routes/app/clientes-novo"), "NovoClientePage");
const EditarClientePage = pagina(() => import("@/routes/app/clientes-editar"), "EditarClientePage");
const ClienteDetalhePage = pagina(() => import("@/routes/app/clientes-detalhe"), "ClienteDetalhePage");
const AniversariosPage = pagina(() => import("@/routes/app/aniversarios"), "AniversariosPage");
const CertificadosPage = pagina(() => import("@/routes/app/certificados"), "CertificadosPage");
const PendenciasFiscaisPage = pagina(() => import("@/routes/app/pendencias-fiscais"), "PendenciasFiscaisPage");
const EquipePage = pagina(() => import("@/routes/app/equipe"), "EquipePage");
const ConfiguracoesPage = pagina(() => import("@/routes/app/configuracoes"), "ConfiguracoesPage");

/** Endereço antigo → novo, preservando a querystring (links já salvos). */
function Redireciona({ para }: { para: string }) {
  const { search } = useLocation();
  return <Navigate to={para + search} replace />;
}

export function App() {
  return (
    <QuemSouEuGate>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<InicioPage />} />
          <Route path="whatsapp" element={<ModuloGate modulo="whatsapp"><ChatPage /></ModuloGate>} />
          {/* Conexões moram em Configurações (um lugar só, como no adv3). */}
          <Route path="whatsapp/conexoes" element={<Navigate to="/configuracoes?tab=conexoes" replace />} />
          <Route path="chamados" element={<ModuloGate modulo="chamados"><ChamadosPage /></ModuloGate>} />
          <Route path="clientes" element={<ModuloGate modulo="clientes"><ClientesPage /></ModuloGate>} />
          <Route path="clientes/aniversarios" element={<ModuloGate modulo="clientes"><AniversariosPage /></ModuloGate>} />
          <Route path="clientes/novo" element={<ModuloGate modulo="clientes"><NovoClientePage /></ModuloGate>} />
          <Route path="clientes/:id" element={<ModuloGate modulo="clientes"><ClienteDetalhePage /></ModuloGate>} />
          <Route path="clientes/:id/editar" element={<ModuloGate modulo="clientes"><EditarClientePage /></ModuloGate>} />
          <Route path="certificados" element={<ModuloGate modulo="certificados"><CertificadosPage /></ModuloGate>} />
          <Route path="pendencias-fiscais" element={<ModuloGate modulo="pendenciasFiscais"><PendenciasFiscaisPage /></ModuloGate>} />
          <Route path="equipe" element={<ModuloGate modulo="equipe"><EquipePage /></ModuloGate>} />
          <Route path="configuracoes" element={<ConfiguracoesPage />} />

          <Route path="atendimento" element={<Redireciona para="/whatsapp" />} />
          <Route path="conexoes" element={<Navigate to="/configuracoes?tab=conexoes" replace />} />
          <Route path="solicitacoes" element={<Redireciona para="/chamados" />} />
          <Route path="aniversarios" element={<Redireciona para="/clientes/aniversarios" />} />
          <Route path="colaboradores" element={<Redireciona para="/equipe" />} />

          <Route
            path="*"
            element={
              <div className="p-8 space-y-2">
                <h1 className="text-title-lg">Página não encontrada</h1>
                <Link to="/" className="text-sm underline">
                  Voltar ao início
                </Link>
              </div>
            }
          />
        </Route>
      </Routes>
    </QuemSouEuGate>
  );
}
