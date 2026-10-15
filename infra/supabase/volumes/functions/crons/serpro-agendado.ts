// Rota POST /crons/serpro-agendado (pg_cron a cada 10 min das 08h às 19h50
// de São Paulo, migration 006).
//
// Cada AgendamentoSerpro ligado roda UM ciclo por mês, no "diaMes" escolhido:
// passa por todos os clientes ativos com CPF/CNPJ (ou só a lista escolhida),
// em ordem de id, um por vez. Como o runtime corta em 150 s, cada chamada
// trabalha ~100 s e grava o cursor; a próxima continua de onde parou.
//
// Travas (cada consulta é cobrada pelo Serpro):
//  - módulo Pendências fiscais desligado ou gateway sem configurar: nada roda;
//  - só serviços de leitura (SITFIS, caixa postal, parcelamentos, procuração);
//    nada que emita guia ou peça PIN. Se o gateway pedir PIN, a consulta fica
//    pendente e o ciclo segue;
//  - problema do sistema (gateway fora, pausado, limite, chave) PARA o ciclo
//    sem avançar o cursor e tenta de novo no próximo pedaço;
//  - 2,5 s entre clientes (o gateway aceita 30/min por operador);
//  - ciclo que não termina em 3 dias é encerrado.

import { supabaseAdmin, TENANT_ID } from "../_shared/supabase.ts";
import { gatewayConfigurado } from "../_shared/serpro.ts";
import {
  type ClienteConsulta,
  contribuinteParaServico,
  executarConsulta,
  type Servico,
  SERVICOS_AGENDAVEIS,
} from "../_shared/serpro-servicos.ts";

const PRAZO_MS = 100_000;
const PAUSA_MS = 2_500;
/** Erros do gateway que são do SISTEMA, não do cliente: param o ciclo. */
const ERROS_DE_SISTEMA = new Set(["NAO_CONFIGURADO", "SEM_RESPOSTA", "PAUSADO", "LIMITE", "HTTP 401", "HTTP 429", "HTTP 503"]);

type Agendamento = {
  id: string;
  servico: string;
  diaMes: number;
  ativo: boolean;
  todosAtivos: boolean;
  clienteIds: string[];
  cicloEm: string | null;
  cicloConcluido: boolean;
  cursor: string | null;
  cicloConsultas: number;
  cicloCusto: number | string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function hojeEmSaoPaulo(agora = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(agora)
      .map((x) => [x.type, x.value]),
  );
  return { iso: `${p.year}-${p.month}-${p.day}`, diaMes: Number(p.day) };
}

/** Deve começar um ciclo hoje? (ligado, ciclo anterior terminado, dia certo, ainda não rodou hoje) */
export function deveIniciar(ag: Pick<Agendamento, "ativo" | "cicloConcluido" | "diaMes" | "cicloEm">, hoje: { iso: string; diaMes: number }) {
  return ag.ativo && ag.cicloConcluido && Number(ag.diaMes) === hoje.diaMes && ag.cicloEm !== hoje.iso;
}

async function atualizar(id: string, campos: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from("AgendamentoSerpro").update(campos).eq("id", id);
  if (error) throw error;
}

export async function serproAgendado(): Promise<Record<string, unknown>> {
  const inicio = Date.now();
  const { data: cfg } = await supabaseAdmin.from("Config").select("valor").eq("chave", "modulos").maybeSingle();
  if ((cfg?.valor as Record<string, unknown> | null)?.pendenciasFiscais === false) {
    return { ok: true, skipped: "modulo-desligado" };
  }

  const { data: ags, error } = await supabaseAdmin
    .from("AgendamentoSerpro")
    .select("*")
    .eq("tenantId", TENANT_ID)
    .or("ativo.eq.true,cicloConcluido.eq.false");
  if (error) throw error;
  const lista = (ags ?? []) as Agendamento[];
  if (lista.length === 0) return { ok: true, agendamentos: 0 };

  const gw = gatewayConfigurado();
  if (!gw.ok) {
    const msg = `Falta configurar o gateway Integra Contador: ${gw.faltando.join(", ")}.`;
    for (const ag of lista.filter((a) => a.ativo)) await atualizar(ag.id, { ultimoErro: msg });
    return { ok: true, skipped: "gateway-nao-configurado" };
  }

  const hoje = hojeEmSaoPaulo();
  const relatorio: Record<string, unknown>[] = [];

  for (const ag0 of lista) {
    if (!SERVICOS_AGENDAVEIS.includes(ag0.servico as (typeof SERVICOS_AGENDAVEIS)[number])) continue;
    let ag = ag0;

    // Desligado no meio do ciclo: encerra.
    if (!ag.ativo && !ag.cicloConcluido) {
      await atualizar(ag.id, { cicloConcluido: true, ultimoResultado: "Ciclo interrompido: agendamento desligado." });
      continue;
    }
    if (deveIniciar(ag, hoje)) {
      ag = { ...ag, cicloEm: hoje.iso, cicloConcluido: false, cursor: null, cicloConsultas: 0, cicloCusto: 0 };
      await atualizar(ag.id, {
        cicloEm: hoje.iso, cicloConcluido: false, cursor: null, cicloConsultas: 0, cicloCusto: 0, ultimoErro: null,
      });
    }
    if (ag.cicloConcluido) continue;
    // Ciclo velho demais (gateway fora por dias): encerra.
    if (ag.cicloEm && Date.parse(hoje.iso) - Date.parse(ag.cicloEm) > 3 * 86_400_000) {
      await atualizar(ag.id, { cicloConcluido: true, ultimoResultado: `Ciclo de ${ag.cicloEm} encerrado sem terminar (mais de 3 dias).` });
      continue;
    }

    const servico = ag.servico as Servico;
    let consultas = Number(ag.cicloConsultas) || 0;
    let custo = Number(ag.cicloCusto) || 0;
    let cursor = ag.cursor;
    let parou: string | null = null;
    let terminou = false;

    while (!parou && !terminou) {
      let q = supabaseAdmin
        .from("Cliente")
        .select('id, nome, "cpfCnpj", ativo, "regimeTributario"')
        .eq("tenantId", TENANT_ID)
        .eq("ativo", true)
        .not("cpfCnpj", "is", null)
        .order("id")
        .limit(50);
      if (cursor) q = q.gt("id", cursor);
      if (!ag.todosAtivos) q = q.in("id", ag.clienteIds.length ? ag.clienteIds : ["-"]);
      const { data: clientes, error: cErr } = await q;
      if (cErr) throw cErr;
      if (!clientes?.length) {
        terminou = true;
        break;
      }
      for (const cli of clientes as ClienteConsulta[]) {
        // SITFIS pode esperar o relatório até 100 s dentro da consulta.
        const folga = servico === "SITFIS" ? 45_000 : 10_000;
        if (Date.now() - inicio > PRAZO_MS - folga) {
          parou = "prazo";
          break;
        }
        const val = contribuinteParaServico(cli, servico);
        if ("recusa" in val) {
          cursor = cli.id; // não se aplica (ex.: parcelamento de Lucro Presumido): pula sem custo
          continue;
        }
        // Desligado agora há pouco? Para na hora.
        const { data: atual } = await supabaseAdmin.from("AgendamentoSerpro").select("ativo").eq("id", ag.id).maybeSingle();
        if (!atual?.ativo) {
          parou = "desligado";
          break;
        }
        const { linha, desfecho } = await executarConsulta({
          cliente: cli,
          contribuinte: val.contribuinte,
          servico,
          body: {},
          operador: "agendamento",
          porId: null,
          origem: "agendamento",
          agendamentoId: ag.id,
        });
        const codigo = String((desfecho.resultado as { gatewayErro?: unknown })?.gatewayErro ?? desfecho.erro ?? "");
        if (desfecho.status === "erro" && ERROS_DE_SISTEMA.has(codigo)) {
          parou = `sistema: ${desfecho.resumo}`;
          break;
        }
        consultas++;
        custo += Number((linha as { custoEstimado?: number | null }).custoEstimado ?? 0) || 0;
        cursor = cli.id;
        await atualizar(ag.id, { cursor, cicloConsultas: consultas, cicloCusto: custo.toFixed(2), ultimaExecucao: new Date().toISOString() });
        await sleep(PAUSA_MS);
      }
    }

    if (terminou) {
      const r = `Ciclo de ${hoje.iso.split("-").reverse().join("/")} concluído: ${consultas} consulta(s), custo estimado R$ ${custo.toFixed(2).replace(".", ",")}.`;
      await atualizar(ag.id, { cicloConcluido: true, cursor: null, ultimoResultado: r, ultimoErro: null, ultimaExecucao: new Date().toISOString() });
    } else if (parou?.startsWith("sistema")) {
      await atualizar(ag.id, { ultimoErro: parou.slice(9, 500), ultimaExecucao: new Date().toISOString() });
    } else if (parou === "desligado") {
      await atualizar(ag.id, { cicloConcluido: true, ultimoResultado: `Ciclo interrompido: desligado após ${consultas} consulta(s).` });
    }
    relatorio.push({ servico, consultas, custo, terminou, parou });
    if (parou === "prazo" || parou?.startsWith("sistema")) break; // sem tempo (ou gateway com problema) pros outros
  }
  return { ok: true, relatorio };
}
