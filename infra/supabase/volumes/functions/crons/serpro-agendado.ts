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
//  - o cursor anda ANTES de chamar o Serpro: se a execução morrer no meio, o
//    cliente fica sem a consulta do mês (a varredura a marca como erro) em vez
//    de ser cobrado duas vezes;
//  - trava por agendamento (`rodandoAte`, migration 013): duas execuções que
//    se sobrepõem nunca processam o mesmo agendamento;
//  - problema do sistema (gateway fora, pausado, limite, chave) PARA o ciclo,
//    devolve o cursor ao cliente anterior (não houve cobrança) e tenta de novo
//    no próximo pedaço;
//  - 2,5 s entre clientes (o gateway aceita 30/min por operador);
//  - ciclo que não termina em 3 dias é encerrado;
//  - varredura: consulta agendada "pendente" sem desfecho há mais de 15 min
//    (execução que morreu no meio) vira erro "Consulta interrompida".

import { supabaseAdmin, TENANT_ID } from "../_shared/supabase.ts";
import { gatewayConfigurado } from "../_shared/serpro.ts";
import {
  type ClienteConsulta,
  contribuinteParaServico,
  executarConsulta,
  type Servico,
  SERVICOS_AGENDAVEIS,
} from "../_shared/serpro-servicos.ts";
import {
  corteVarredura,
  deveIniciar,
  ehErroDeSistema,
  hojeEmSaoPaulo,
  problemaDoCliente,
  RESUMO_INTERROMPIDA,
  temTrabalho,
  TRAVA_SEGUNDOS,
} from "./serpro-agendado-regra.ts";

export { deveIniciar, hojeEmSaoPaulo } from "./serpro-agendado-regra.ts";

const PRAZO_MS = 100_000;
const PAUSA_MS = 2_500;

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

type Hoje = { iso: string; diaMes: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function atualizar(id: string, campos: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from("AgendamentoSerpro").update(campos).eq("id", id);
  if (error) throw error;
}

/** Pega a trava do agendamento e devolve a linha atualizada; null = outra execução está com ele. */
async function travar(id: string): Promise<Agendamento | null> {
  const { data, error } = await supabaseAdmin.rpc("agendamento_serpro_travar", { p_id: id, p_segundos: TRAVA_SEGUNDOS });
  if (error) throw error;
  const linhas = (data ?? []) as Agendamento[];
  return linhas[0] ?? null;
}

async function soltar(id: string) {
  const { error } = await supabaseAdmin.from("AgendamentoSerpro").update({ rodandoAte: null }).eq("id", id);
  if (error) console.error("serpro-agendado: soltar trava", error.message);
}

/** Consultas agendadas que ficaram "pendente" sem desfecho (a execução morreu no meio) viram erro. */
async function varrerInterrompidas(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("ConsultaFiscal")
    .update({ status: "erro", resumo: RESUMO_INTERROMPIDA, erro: "interrompida" })
    .eq("tenantId", TENANT_ID)
    .eq("origem", "agendamento")
    .eq("status", "pendente")
    // Sem resumo = nunca recebeu desfecho. Pendente COM resumo é legítimo
    // (relatório do SITFIS em processamento, pedido de PIN) e fica como está.
    .is("resumo", null)
    .lt("criadoEm", corteVarredura())
    .select("id");
  if (error) {
    console.error("serpro-agendado: varredura", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

/** Quantas consultas deste ciclo terminaram com erro ou pendentes. */
async function problemasDoCiclo(agId: string, cicloEm: string | null): Promise<number> {
  if (!cicloEm) return 0;
  const { count } = await supabaseAdmin
    .from("ConsultaFiscal")
    .select("id", { count: "exact", head: true })
    .eq("agendamentoId", agId)
    .in("status", ["erro", "pendente"])
    .gte("criadoEm", `${cicloEm}T00:00:00-03:00`);
  return count ?? 0;
}

export async function serproAgendado(): Promise<Record<string, unknown>> {
  const inicio = Date.now();
  const varridas = await varrerInterrompidas();

  const { data: cfg } = await supabaseAdmin.from("Config").select("valor").eq("chave", "modulos").maybeSingle();
  if ((cfg?.valor as Record<string, unknown> | null)?.pendenciasFiscais === false) {
    return { ok: true, skipped: "modulo-desligado", varridas };
  }

  const { data: ags, error } = await supabaseAdmin
    .from("AgendamentoSerpro")
    .select("*")
    .eq("tenantId", TENANT_ID)
    .or("ativo.eq.true,cicloConcluido.eq.false");
  if (error) throw error;
  const lista = (ags ?? []) as Agendamento[];
  if (lista.length === 0) return { ok: true, agendamentos: 0, varridas };

  const gw = gatewayConfigurado();
  if (!gw.ok) {
    const msg = `Falta configurar o gateway Integra Contador: ${gw.faltando.join(", ")}.`;
    for (const ag of lista.filter((a) => a.ativo)) await atualizar(ag.id, { ultimoErro: msg });
    return { ok: true, skipped: "gateway-nao-configurado", varridas };
  }

  const hoje = hojeEmSaoPaulo();
  const relatorio: Record<string, unknown>[] = [];

  for (const ag0 of lista) {
    if (!SERVICOS_AGENDAVEIS.includes(ag0.servico as (typeof SERVICOS_AGENDAVEIS)[number])) continue;
    if (!temTrabalho(ag0, hoje)) continue;
    // A trava devolve a linha FRESCA: outra execução pode ter andado o cursor
    // entre a lista acima e agora.
    const travado = await travar(ag0.id);
    if (!travado) {
      relatorio.push({ servico: ag0.servico, pulou: "em-execucao" });
      continue;
    }
    let parou: string | null = null;
    try {
      parou = await processar(travado, hoje, inicio, relatorio);
    } finally {
      await soltar(travado.id);
    }
    if (parou === "prazo" || parou?.startsWith("sistema")) break; // sem tempo (ou gateway com problema) pros outros
  }
  return { ok: true, relatorio, varridas };
}

/** Um pedaço do ciclo de um agendamento (já travado). Devolve por que parou (ou null). */
async function processar(
  ag0: Agendamento,
  hoje: Hoje,
  inicio: number,
  relatorio: Record<string, unknown>[],
): Promise<string | null> {
  let ag = ag0;
  // Desligado no meio do ciclo: encerra.
  if (!ag.ativo && !ag.cicloConcluido) {
    await atualizar(ag.id, { cicloConcluido: true, ultimoResultado: "Ciclo interrompido: agendamento desligado." });
    return null;
  }
  if (deveIniciar(ag, hoje)) {
    ag = { ...ag, cicloEm: hoje.iso, cicloConcluido: false, cursor: null, cicloConsultas: 0, cicloCusto: 0 };
    await atualizar(ag.id, {
      cicloEm: hoje.iso, cicloConcluido: false, cursor: null, cicloConsultas: 0, cicloCusto: 0, ultimoErro: null,
    });
  }
  if (ag.cicloConcluido) return null;
  // Ciclo velho demais (gateway fora por dias): encerra.
  if (ag.cicloEm && Date.parse(hoje.iso) - Date.parse(ag.cicloEm) > 3 * 86_400_000) {
    await atualizar(ag.id, { cicloConcluido: true, ultimoResultado: `Ciclo de ${ag.cicloEm} encerrado sem terminar (mais de 3 dias).` });
    return null;
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
      // Cursor gravado ANTES da consulta cobrada: se a execução morrer daqui
      // em diante, a próxima segue do cliente seguinte (nunca cobra 2 vezes).
      const cursorAntes = cursor;
      cursor = cli.id;
      await atualizar(ag.id, { cursor, ultimaExecucao: new Date().toISOString() });
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
      if (ehErroDeSistema(desfecho)) {
        // Não chegou a ser cobrada: o cliente volta para o próximo pedaço.
        cursor = cursorAntes;
        await atualizar(ag.id, { cursor });
        parou = `sistema: ${desfecho.resumo}`;
        break;
      }
      consultas++;
      custo += Number((linha as { custoEstimado?: number | null }).custoEstimado ?? 0) || 0;
      const problema = problemaDoCliente(cli.nome, desfecho);
      await atualizar(ag.id, {
        cicloConsultas: consultas,
        cicloCusto: custo.toFixed(2),
        ultimaExecucao: new Date().toISOString(),
        ...(problema ? { ultimoErro: problema } : {}),
      });
      await sleep(PAUSA_MS);
    }
  }

  if (terminou) {
    const problemas = await problemasDoCiclo(ag.id, ag.cicloEm);
    const r = `Ciclo de ${hoje.iso.split("-").reverse().join("/")} concluído: ${consultas} consulta(s)` +
      (problemas ? `, ${problemas} com erro ou pendente(s)` : "") +
      `, custo estimado R$ ${custo.toFixed(2).replace(".", ",")}.`;
    await atualizar(ag.id, {
      cicloConcluido: true,
      cursor: null,
      ultimoResultado: r,
      ultimoErro: problemas ? `${problemas} consulta(s) deste ciclo terminaram com erro ou pendentes: veja o histórico.` : null,
      ultimaExecucao: new Date().toISOString(),
    });
  } else if (parou?.startsWith("sistema")) {
    await atualizar(ag.id, { ultimoErro: parou.slice(9, 500), ultimaExecucao: new Date().toISOString() });
  } else if (parou === "desligado") {
    await atualizar(ag.id, { cicloConcluido: true, ultimoResultado: `Ciclo interrompido: desligado após ${consultas} consulta(s).` });
  } else if (parou === "prazo" && cursor !== ag.cursor) {
    // Clientes pulados sem custo no fim do pedaço também andam o cursor.
    await atualizar(ag.id, { cursor });
  }
  relatorio.push({ servico, consultas, custo, terminou, parou });
  return parou;
}
