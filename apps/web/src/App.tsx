import { lazy, type ComponentType } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { QuemSouEuGate } from "@/components/quem-sou-eu";
import { AppLayout } from "@/layouts/app-layout";

// Cada página em chunk próprio: o WhatsApp (o maior) não pesa no Início.
function pagina<T>(imp: () => Promise<T>, nome: keyof T) {
  return lazy(() => imp().then((m) => ({ default: m[nome] as unknown as ComponentType })));
}

const InicioPage = pagina(() => import("@/routes/app/inicio"), "InicioPage");
const ChatPage = pagina(() => import("@/routes/app/chat"), "ChatPage");
const InboxCanaisPage = pagina(() => import("@/routes/app/inbox-canais"), "InboxCanaisPage");
const ChamadosPage = pagina(() => import("@/routes/app/chamados"), "ChamadosPage");
const ClientesPage = pagina(() => import("@/routes/app/clientes"), "ClientesPage");
const NovoClientePage = pagina(() => import("@/routes/app/clientes-novo"), "NovoClientePage");
const EditarClientePage = pagina(() => import("@/routes/app/clientes-editar"), "EditarClientePage");
const ClienteDetalhePage = pagina(() => import("@/routes/app/clientes-detalhe"), "ClienteDetalhePage");
const AniversariosPage = pagina(() => import("@/routes/app/aniversarios"), "AniversariosPage");
const CertificadosPage = pagina(() => import("@/routes/app/certificados"), "CertificadosPage");
const PendenciasFiscaisPage = pagina(() => import("@/routes/app/pendencias-fiscais"), "PendenciasFiscaisPage");
const EquipePage = pagina(() => import("@/routes/app/equipe"), "EquipePage");

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
          <Route path="whatsapp" element={<ChatPage />} />
          <Route path="whatsapp/conexoes" element={<InboxCanaisPage />} />
          <Route path="chamados" element={<ChamadosPage />} />
          <Route path="clientes" element={<ClientesPage />} />
          <Route path="clientes/aniversarios" element={<AniversariosPage />} />
          <Route path="clientes/novo" element={<NovoClientePage />} />
          <Route path="clientes/:id" element={<ClienteDetalhePage />} />
          <Route path="clientes/:id/editar" element={<EditarClientePage />} />
          <Route path="certificados" element={<CertificadosPage />} />
          <Route path="pendencias-fiscais" element={<PendenciasFiscaisPage />} />
          <Route path="equipe" element={<EquipePage />} />

          <Route path="atendimento" element={<Redireciona para="/whatsapp" />} />
          <Route path="conexoes" element={<Redireciona para="/whatsapp/conexoes" />} />
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
