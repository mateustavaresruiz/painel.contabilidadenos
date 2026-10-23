// Módulos da fase 2 (reunião com a Franceli em 07/10/2026): aparecem no menu
// com o selo "Em breve" e abrem uma página que explica o que vai ter. Nada
// funciona ainda: é para a dona do escritório ver o caminho e opinar.
//
// Quando um módulo sair do papel, ele vira item normal em app-nav.ts e sai
// daqui.

import type { LucideIcon } from "lucide-react";
import { FileSignature, ListChecks, Target, Wallet } from "lucide-react";

export type ModuloEmBreve = {
  chave: string;
  titulo: string;
  icone: LucideIcon;
  /** Uma frase: o problema que o módulo resolve. */
  resumo: string;
  funcionalidades: string[];
  /** Observações combinadas (custos, dependências). */
  observacoes?: string[];
};

export const MODULOS_EM_BREVE: ModuloEmBreve[] = [
  {
    chave: "comercial",
    titulo: "Comercial (CRM)",
    icone: Target,
    resumo: "Acompanhar quem pediu orçamento até virar cliente, sem perder ninguém no caminho.",
    funcionalidades: [
      "Funil de oportunidades: novo contato, proposta enviada, negociação, fechado.",
      "Contatos que chegam pelo WhatsApp e pelo site entram direto no funil.",
      "Lembrete de retorno (follow-up) com data e responsável.",
      "Proposta com valor de honorário e histórico de cada conversa.",
      "Ao fechar, o contato vira cliente com um clique, já com os dados preenchidos.",
    ],
  },
  {
    chave: "financeiro",
    titulo: "Financeiro e cobranças",
    icone: Wallet,
    resumo: "Saber quem pagou e cobrar quem atrasou sem conferir boleto por boleto.",
    funcionalidades: [
      "Honorário mensal de cada cliente, com dia de vencimento.",
      "Régua de cobrança pelo WhatsApp: aviso no dia do vencimento e nos dias seguintes (sem enviar antes).",
      "Painel de inadimplência: quem está em atraso, há quantos dias e quanto.",
      "Conferência dos pagamentos com o Conta Azul, se a integração for viável.",
    ],
    observacoes: [
      "Cobrança automática em massa usa a API oficial do WhatsApp, num número exclusivo para isso (cerca de R$ 0,30 por mensagem), para não arriscar o número do atendimento.",
    ],
  },
  {
    chave: "contratos",
    titulo: "Contratos",
    icone: FileSignature,
    resumo: "Gerar o contrato de prestação de serviço e colher a assinatura sem imprimir nada.",
    funcionalidades: [
      "Contrato a partir de um modelo, com os dados do cliente e o honorário preenchidos.",
      "Envio para assinatura eletrônica e aviso quando o cliente assinar.",
      "Aditivos e reajustes registrados no cadastro do cliente.",
      "Contrato assinado guardado junto da ficha do cliente.",
    ],
  },
  {
    chave: "tarefas",
    titulo: "Tarefas e entregas",
    icone: ListChecks,
    resumo: "As obrigações de cada cliente com prazo e responsável, e as guias entregues pelo portal.",
    funcionalidades: [
      "Obrigações recorrentes por cliente (mensais e anuais) criadas sozinhas a cada mês.",
      "Responsável, prazo e aviso do que vence hoje e nesta semana.",
      "Entrega de guias e documentos pelo portal do cliente, com confirmação de que ele baixou.",
      "Pensado para substituir o Acessórias quando a equipe estiver pronta para trocar.",
    ],
  },
];

export function moduloEmBreve(chave: string | undefined): ModuloEmBreve | undefined {
  return MODULOS_EM_BREVE.find((m) => m.chave === chave);
}
