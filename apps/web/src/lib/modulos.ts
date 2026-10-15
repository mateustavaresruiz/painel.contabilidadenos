// Módulos ligáveis (Config 'modulos') e marca do escritório (Tenant.nome +
// Config 'marca.logo'). Gravar exige configuracoes.gerenciar (RLS).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useEu } from "@/lib/colaborador";
import { supabase } from "@/lib/supabase";

export type ModuloChave =
  | "whatsapp"
  | "chamados"
  | "clientes"
  | "certificados"
  | "pendenciasFiscais"
  | "equipe"
  | "certificadosAvisos"
  | "aniversarioParabens"
  | "chamadoNaConversa"
  | "transferenciaAtendimento"
  | "loginSemVerificacao";

export type Modulos = Record<ModuloChave, boolean>;

export const MODULOS_PADRAO: Modulos = {
  whatsapp: true,
  chamados: true,
  clientes: true,
  certificados: true,
  pendenciasFiscais: true,
  equipe: true,
  certificadosAvisos: true,
  aniversarioParabens: true,
  chamadoNaConversa: true,
  transferenciaAtendimento: true,
  loginSemVerificacao: true,
};

/** Módulos principais (cada um tem página e item no menu). */
export const MODULOS_PRINCIPAIS: { chave: ModuloChave; nome: string; descricao: string; rota: string }[] = [
  { chave: "whatsapp", nome: "WhatsApp", descricao: "Conversas, atendimento e conexões dos números.", rota: "/whatsapp" },
  { chave: "chamados", nome: "Chamados", descricao: "Pedidos dos clientes com tipo, prazo e responsável.", rota: "/chamados" },
  { chave: "clientes", nome: "Clientes e aniversários", descricao: "Cadastro de empresas, pessoas, sócios e datas.", rota: "/clientes" },
  { chave: "certificados", nome: "Certificados digitais", descricao: "Validade dos certificados e avisos de vencimento.", rota: "/certificados" },
  { chave: "pendenciasFiscais", nome: "Pendências fiscais", descricao: "Consultas ao Integra Contador do Serpro.", rota: "/pendencias-fiscais" },
  { chave: "equipe", nome: "Equipe", descricao: "Cadastro de quem atende pelo painel.", rota: "/equipe" },
];

/** Funções dentro dos módulos; cada uma depende do módulo `pai`. */
export const SUBFUNCOES: { chave: ModuloChave; pai: ModuloChave; nome: string; descricao: string }[] = [
  {
    chave: "certificadosAvisos",
    pai: "certificados",
    nome: "Avisos automáticos de certificado",
    descricao: "Envio diário pelo WhatsApp, às 9h, nos marcos de vencimento.",
  },
  {
    chave: "aniversarioParabens",
    pai: "clientes",
    nome: "Botão de parabéns de aniversário",
    descricao: "Abre a conversa com a mensagem de parabéns já escrita.",
  },
  {
    chave: "chamadoNaConversa",
    pai: "chamados",
    nome: "Abrir chamado na conversa",
    descricao: "Botão e seção de chamados dentro da conversa do WhatsApp.",
  },
  {
    chave: "transferenciaAtendimento",
    pai: "whatsapp",
    nome: "Transferência de atendimento",
    descricao: "Passar a conversa para outra pessoa da equipe.",
  },
  {
    chave: "loginSemVerificacao",
    pai: "equipe",
    nome: "Entrar só com o e-mail (provisório)",
    descricao: "Entra sem conferir a caixa de entrada. Quem souber o e-mail de alguém da equipe entra como ele. Desligue quando o e-mail do painel estiver funcionando.",
  },
];

export function useModulos() {
  const query = useQuery({
    queryKey: ["config", "modulos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("Config").select("valor").eq("chave", "modulos").maybeSingle();
      if (error) throw error;
      const salvo = (data?.valor ?? {}) as Partial<Modulos>;
      return { ...MODULOS_PADRAO, ...salvo } as Modulos;
    },
    staleTime: 5 * 60_000,
  });
  // Enquanto carrega, tudo ligado: o menu não "pisca" sem itens.
  const modulos = query.data ?? MODULOS_PADRAO;
  /** Sub-função só vale com o módulo pai ligado. */
  const ativo = (chave: ModuloChave): boolean => {
    if (!modulos[chave]) return false;
    const sub = SUBFUNCOES.find((s) => s.chave === chave);
    return sub ? modulos[sub.pai] : true;
  };
  return { modulos, ativo, carregando: query.isLoading };
}

export function useSalvarModulos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modulos: Modulos) => {
      const { error } = await supabase
        .from("Config")
        .upsert({ chave: "modulos", valor: modulos, atualizadoEm: new Date().toISOString() });
      if (error) throw error;
      return modulos;
    },
    onMutate: async (modulos) => {
      await qc.cancelQueries({ queryKey: ["config", "modulos"] });
      const anterior = qc.getQueryData<Modulos>(["config", "modulos"]);
      qc.setQueryData(["config", "modulos"], modulos);
      return { anterior };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.anterior) qc.setQueryData(["config", "modulos"], ctx.anterior);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["config", "modulos"] }),
  });
}

/** Pode mexer nas Configurações do painel (permissão configuracoes.gerenciar). */
export function useEhAdmin(): boolean {
  return useEu().tem("configuracoes.gerenciar");
}

// ---------------------------------------------------------------------------
// Marca: nome do escritório e logo
// ---------------------------------------------------------------------------

export type Marca = { nome: string; logoUrl: string | null; logoPath: string | null };

export function useMarca() {
  return useQuery({
    queryKey: ["config", "marca"],
    queryFn: async (): Promise<Marca> => {
      const [t, c] = await Promise.all([
        supabase.from("Tenant").select("nome").eq("id", "denos").maybeSingle(),
        supabase.from("Config").select("valor").eq("chave", "marca.logo").maybeSingle(),
      ]);
      if (t.error) throw t.error;
      if (c.error) throw c.error;
      const path = typeof c.data?.valor === "string" ? c.data.valor : null;
      const logoUrl = path ? supabase.storage.from("marca").getPublicUrl(path).data.publicUrl : null;
      return { nome: (t.data?.nome as string | undefined) ?? "Contabilidade Denos", logoUrl, logoPath: path };
    },
    staleTime: 10 * 60_000,
  });
}

export function useSalvarNomeEscritorio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nome: string) => {
      const { error } = await supabase.from("Tenant").update({ nome: nome.trim() }).eq("id", "denos");
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["config", "marca"] }),
  });
}

const MIME_LOGO = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

/** Sobe a logo no bucket público `marca` e grava o caminho em Config. `null` volta à logo NÓS. */
export function useSalvarLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (arquivo: File | null) => {
      const anterior = qc.getQueryData<Marca>(["config", "marca"])?.logoPath ?? null;
      let path: string | null = null;
      if (arquivo) {
        if (!MIME_LOGO.includes(arquivo.type)) throw new Error("Use PNG, JPG, WEBP ou SVG.");
        if (arquivo.size > 2 * 1024 * 1024) throw new Error("A logo pode ter no máximo 2 MB.");
        const ext = arquivo.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
        // Nome novo a cada envio: a URL pública muda e nenhum cache segura a antiga.
        path = `logo-${Date.now()}.${ext}`;
        const up = await supabase.storage.from("marca").upload(path, arquivo, {
          contentType: arquivo.type,
          upsert: false,
          cacheControl: "31536000",
        });
        if (up.error) throw up.error;
      }
      // `valor` é jsonb NOT NULL e o PostgREST grava null como NULL de SQL:
      // sem logo, a linha sai (a leitura trata a ausência).
      const { error } = path
        ? await supabase
            .from("Config")
            .upsert({ chave: "marca.logo", valor: path, atualizadoEm: new Date().toISOString() })
        : await supabase.from("Config").delete().eq("chave", "marca.logo");
      if (error) throw error;
      if (anterior && anterior !== path) await supabase.storage.from("marca").remove([anterior]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["config", "marca"] }),
  });
}
