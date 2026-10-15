// Saúde do sistema: banco (RPC painel_saude), WhatsApp/WAHA, Serpro e
// tarefas agendadas. Usado em Configurações > Integrações / Sistema e na
// faixa "Saúde" da Visão geral. Tudo sob demanda (abrir a tela ou clicar em
// "Verificar"), sem relógio.

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useSerproStatus, type SerproStatus } from "@/lib/queries/denos";
import { useWhatsappSessoes } from "@/lib/queries/whatsapp";
import { supabase } from "@/lib/supabase";

export type CronSaude = {
  nome: string;
  agenda: string;
  ativo: boolean;
  ultimaExecucao: string | null;
  fimExecucao: string | null;
  status: string | null;
  mensagem: string | null;
  falhas24h: number;
};

export type PainelSaude = {
  agora: string;
  migracoes: { nome: string; aplicadaEm: string }[];
  tabelas: Record<string, number>;
  erros24h: number;
  crons: CronSaude[];
};

export function usePainelSaude() {
  return useQuery({
    queryKey: ["painel-saude"],
    queryFn: async () => {
      const t0 = performance.now();
      const { data, error } = await supabase.rpc("painel_saude");
      if (error) throw error;
      return { ...(data as PainelSaude), latenciaMs: Math.round(performance.now() - t0) };
    },
    retry: false,
    meta: { silencioso: true },
    staleTime: 60_000,
  });
}

export type WhatsappStatus = {
  wahaConfigurado: boolean;
  webhookSecretConfigurado: boolean;
  webhookUrl: string;
};

export function useWhatsappStatus(habilitado = true) {
  return useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: () => api<WhatsappStatus>("/whatsapp/status"),
    enabled: habilitado,
    retry: false,
    meta: { silencioso: true },
    staleTime: 60_000,
  });
}

export type ErroLog = {
  id: number;
  origem: string;
  nivel: "error" | "warn";
  mensagem: string;
  stack: string | null;
  contexto: Record<string, unknown> | null;
  rota: string | null;
  status: number | null;
  duracaoMs: number | null;
  criadoEm: string;
};

export function useErrosRecentes() {
  return useQuery({
    queryKey: ["painel-erros"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("painel_erros", { p_limite: 50 });
      if (error) throw error;
      return (data ?? []) as ErroLog[];
    },
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Tarefas agendadas em português
// ---------------------------------------------------------------------------

export const CRON_DESCRICAO: Record<string, string> = {
  "whatsapp-keepalive": "Confere o status das conexões do WhatsApp com o WAHA",
  "whatsapp-fotos-pendentes": "Baixa as fotos de perfil que ainda faltam",
  "certificados-avisos": "Avisa os clientes do vencimento do certificado digital",
  "purga-diaria": "Limpa logs antigos (eventos, freio de requisições e erros)",
};

const dois = (n: number) => String(n).padStart(2, "0");

/**
 * Agenda do pg_cron (em UTC) em português, no horário de Brasília (UTC-3).
 * Cobre os formatos usados no painel; o resto aparece como está.
 */
export function agendaEmPortugues(expr: string): string {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return expr;
  const [min, hora, dia, mes, sem] = p as [string, string, string, string, string];
  const todoDia = dia === "*" && mes === "*" && sem === "*";
  if (!todoDia) return expr;
  const aCada = /^\*\/(\d+)$/.exec(min);
  if (aCada && hora === "*") return `A cada ${aCada[1]} minutos`;
  if (min === "*" && hora === "*") return "A cada minuto";
  if (/^\d+$/.test(min) && hora === "*") return `De hora em hora, aos ${dois(Number(min))} minutos`;
  if (/^\d+$/.test(min) && /^\d+$/.test(hora)) {
    const h = (Number(hora) - 3 + 24) % 24;
    return `Todo dia às ${dois(h)}:${dois(Number(min))}`;
  }
  return expr;
}

// ---------------------------------------------------------------------------
// Resumo para a faixa de saúde
// ---------------------------------------------------------------------------

export type Estado = "ok" | "atencao" | "erro" | "carregando";

export type ItemSaude = { chave: string; nome: string; estado: Estado; detalhe: string };

export function estadoSerpro(s: SerproStatus | undefined, erro: unknown): { estado: Estado; detalhe: string } {
  if (erro) return { estado: "erro", detalhe: "Função fora do ar" };
  if (!s) return { estado: "carregando", detalhe: "Verificando" };
  if (s.pausado) return { estado: "atencao", detalhe: "Pausado no gateway" };
  if (s.configurado) {
    const dias = s.certificado && s.certificado.ok ? s.certificado.diasParaVencer : null;
    if (dias != null && dias <= 30) return { estado: "atencao", detalhe: `Certificado vence em ${dias} dias` };
    return { estado: "ok", detalhe: "Pronto" };
  }
  if (s.gatewayAlcancavel === false) return { estado: "erro", detalhe: "Gateway inalcançável" };
  return { estado: "atencao", detalhe: "Falta configurar" };
}

/**
 * Estado de cada integração. `modulos` decide o que entra (WhatsApp e Serpro
 * só quando o módulo está ligado).
 */
export function useResumoSaude(opts: { whatsapp: boolean; serpro: boolean }): ItemSaude[] {
  const banco = usePainelSaude();
  const wa = useWhatsappStatus(opts.whatsapp);
  const { data: sessoes } = useWhatsappSessoes();
  const serpro = useSerproStatus();

  const itens: ItemSaude[] = [];

  itens.push(
    banco.isLoading
      ? { chave: "banco", nome: "Banco", estado: "carregando", detalhe: "Verificando" }
      : banco.error
        ? { chave: "banco", nome: "Banco", estado: "erro", detalhe: "Sem resposta" }
        : {
            chave: "banco",
            nome: "Banco",
            estado: (banco.data?.erros24h ?? 0) > 0 ? "atencao" : "ok",
            detalhe:
              (banco.data?.erros24h ?? 0) > 0
                ? `${banco.data!.erros24h} erro(s) nas últimas 24h`
                : `Respondendo (${banco.data?.latenciaMs ?? 0} ms)`,
          },
  );

  if (opts.whatsapp) {
    const online = (sessoes ?? []).filter((s) => s.status === "WORKING").length;
    const total = (sessoes ?? []).length;
    itens.push(
      wa.isLoading
        ? { chave: "whatsapp", nome: "WhatsApp", estado: "carregando", detalhe: "Verificando" }
        : wa.error
          ? { chave: "whatsapp", nome: "WhatsApp", estado: "erro", detalhe: "Função fora do ar" }
          : !wa.data?.wahaConfigurado
            ? { chave: "whatsapp", nome: "WhatsApp", estado: "atencao", detalhe: "WAHA não configurado" }
            : total === 0
              ? { chave: "whatsapp", nome: "WhatsApp", estado: "atencao", detalhe: "Nenhum número conectado" }
              : {
                  chave: "whatsapp",
                  nome: "WhatsApp",
                  estado: online === total ? "ok" : "atencao",
                  detalhe: `${online} de ${total} online`,
                },
    );
  }

  if (opts.serpro) {
    const s = estadoSerpro(serpro.data, serpro.error);
    itens.push({ chave: "serpro", nome: "Serpro", ...s });
  }

  const crons = banco.data?.crons ?? [];
  const falhas = crons.filter((c) => c.status === "failed" || c.falhas24h > 0).length;
  itens.push(
    banco.isLoading
      ? { chave: "crons", nome: "Tarefas agendadas", estado: "carregando", detalhe: "Verificando" }
      : banco.error
        ? { chave: "crons", nome: "Tarefas agendadas", estado: "erro", detalhe: "Sem resposta" }
        : {
            chave: "crons",
            nome: "Tarefas agendadas",
            estado: falhas > 0 ? "atencao" : "ok",
            detalhe: falhas > 0 ? `${falhas} com falha` : `${crons.filter((c) => c.ativo).length} ativas`,
          },
  );

  return itens;
}
