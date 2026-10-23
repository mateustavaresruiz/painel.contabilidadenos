import { createElement, type ComponentType } from "react";

/**
 * Página em chunk próprio, com pré-carga.
 *
 * Faz o papel do `React.lazy`, com uma diferença que importa para a navegação
 * parecer instantânea: depois que o chunk chegou (pela pré-carga no hover do
 * menu ou no tempo ocioso), a página renderiza na hora, sem suspender. O
 * `lazy` suspende sempre na primeira montagem, mesmo com o módulo já baixado,
 * e isso piscava a tela em branco por um quadro e impedia a View Transition.
 */
export type Pagina = ComponentType & { preload: () => Promise<void> };

function pagina<T>(imp: () => Promise<T>, nome: keyof T): Pagina {
  let Comp: ComponentType | null = null;
  let erro: unknown = null;
  let promessa: Promise<void> | null = null;
  const preload = () =>
    (promessa ??= imp().then(
      (m) => {
        Comp = m[nome] as unknown as ComponentType;
      },
      (e) => {
        // Libera nova tentativa (o ErrorBoundary oferece recarregar).
        erro = e;
        promessa = null;
      },
    ));
  function PaginaLazy() {
    if (Comp) return createElement(Comp);
    if (erro) {
      const e = erro;
      erro = null;
      throw e;
    }
    // Suspense: mostra o fallback até o chunk chegar.
    throw preload();
  }
  return Object.assign(PaginaLazy, { preload });
}

export const InicioPage = pagina(() => import("@/routes/app/inicio"), "InicioPage");
export const ChatPage = pagina(() => import("@/routes/app/chat"), "ChatPage");
export const ChamadosPage = pagina(() => import("@/routes/app/chamados"), "ChamadosPage");
export const ClientesPage = pagina(() => import("@/routes/app/clientes"), "ClientesPage");
export const NovoClientePage = pagina(() => import("@/routes/app/clientes-novo"), "NovoClientePage");
export const EditarClientePage = pagina(() => import("@/routes/app/clientes-editar"), "EditarClientePage");
export const ClienteDetalhePage = pagina(() => import("@/routes/app/clientes-detalhe"), "ClienteDetalhePage");
export const AniversariosPage = pagina(() => import("@/routes/app/aniversarios"), "AniversariosPage");
export const CertificadosPage = pagina(() => import("@/routes/app/certificados"), "CertificadosPage");
export const PendenciasFiscaisPage = pagina(() => import("@/routes/app/pendencias-fiscais"), "PendenciasFiscaisPage");
export const EquipePage = pagina(() => import("@/routes/app/equipe"), "EquipePage");
export const PerfilColaboradorPage = pagina(() => import("@/routes/app/equipe-perfil"), "PerfilColaboradorPage");
export const ConfiguracoesPage = pagina(() => import("@/routes/app/configuracoes"), "ConfiguracoesPage");
export const EmBrevePage = pagina(() => import("@/routes/app/em-breve"), "EmBrevePage");

/** Caminho do menu → chunk da página (pré-carga no hover/foco do item). */
const POR_CAMINHO: Record<string, Pagina> = {
  "/": InicioPage,
  "/whatsapp": ChatPage,
  "/chamados": ChamadosPage,
  "/clientes": ClientesPage,
  "/clientes/aniversarios": AniversariosPage,
  "/certificados": CertificadosPage,
  "/pendencias-fiscais": PendenciasFiscaisPage,
  "/equipe": EquipePage,
  "/configuracoes": ConfiguracoesPage,
};

export function paginaDoCaminho(to: string): Pagina | undefined {
  return POR_CAMINHO[to.split("?")[0]];
}

/** Baixa o chunk da página do caminho (sem erro: falha aqui não é falha de navegação). */
export function preCarregar(to: string): Promise<void> {
  return paginaDoCaminho(to)?.preload().catch(() => {}) ?? Promise.resolve();
}

type ConexaoInfo = { saveData?: boolean; effectiveType?: string };

/** "Economia de dados" ligada ou rede 2G/3G (Network Information API; sem ela, false). */
export function conexaoEconomica(): boolean {
  const c = (navigator as Navigator & { connection?: ConexaoInfo }).connection;
  if (!c) return false;
  return c.saveData === true || ["slow-2g", "2g", "3g"].includes(c.effectiveType ?? "");
}

/**
 * Pré-carga ociosa das páginas do menu (o primeiro clique já abre na hora).
 * Em rede econômica não baixa nada por conta própria: o hover/foco do item
 * continua pré-carregando só a página que a pessoa vai abrir. Devolve o
 * cancelamento (para o cleanup do efeito).
 */
export function preCarregarOcioso(caminhos: string[]): () => void {
  if (conexaoEconomica()) return () => {};
  const ocioso = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
  const cancelar = window.cancelIdleCallback ?? window.clearTimeout;
  const id = ocioso(() => {
    caminhos.forEach((c) => void preCarregar(c));
  });
  return () => cancelar(id);
}
