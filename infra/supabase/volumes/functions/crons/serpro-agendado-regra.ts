// Partes puras do cron do Serpro agendado (sem banco nem variáveis de ambiente),
// testadas em serpro-agendado-regra_test.ts.

export type AgendamentoCiclo = {
  ativo: boolean;
  cicloConcluido: boolean;
  diaMes: number;
  cicloEm: string | null;
};

/** Erros do gateway que são do SISTEMA, não do cliente: param o ciclo. */
export const ERROS_DE_SISTEMA = new Set(["NAO_CONFIGURADO", "SEM_RESPOSTA", "PAUSADO", "LIMITE", "HTTP 401", "HTTP 429", "HTTP 503"]);

/** Quanto tempo uma execução segura o agendamento (o runtime corta em 150 s). */
export const TRAVA_SEGUNDOS = 300;

/** Consulta agendada ainda "pendente" e sem desfecho depois disto: a execução morreu no meio. */
export const PENDENTE_MAX_MS = 15 * 60_000;
export const RESUMO_INTERROMPIDA = "Consulta interrompida (tempo esgotado)";

export function hojeEmSaoPaulo(agora = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(agora)
      .map((x) => [x.type, x.value]),
  );
  return { iso: `${p.year}-${p.month}-${p.day}`, diaMes: Number(p.day) };
}

/** Deve começar um ciclo hoje? (ligado, ciclo anterior terminado, dia certo, ainda não rodou hoje) */
export function deveIniciar(ag: AgendamentoCiclo, hoje: { iso: string; diaMes: number }) {
  return ag.ativo && ag.cicloConcluido && Number(ag.diaMes) === hoje.diaMes && ag.cicloEm !== hoje.iso;
}

/**
 * Há trabalho para este agendamento agora? (começar ciclo, continuar um em
 * andamento ou encerrar um que foi desligado no meio). Só nesse caso a
 * execução pega a trava; o resto é ignorado sem escrever no banco.
 */
export function temTrabalho(ag: AgendamentoCiclo, hoje: { iso: string; diaMes: number }) {
  return !ag.cicloConcluido || deveIniciar(ag, hoje);
}

/** O desfecho é problema do sistema (gateway fora, pausado, limite...)? Não é cobrado; o ciclo para e repete o cliente. */
export function ehErroDeSistema(d: { status: string; erro?: string | null; resultado?: unknown }): boolean {
  const codigo = String((d.resultado as { gatewayErro?: unknown } | null | undefined)?.gatewayErro ?? d.erro ?? "");
  return d.status === "erro" && ERROS_DE_SISTEMA.has(codigo);
}

/** Texto do `ultimoErro` quando a consulta de um cliente termina com erro ou pendente; null se deu certo. */
export function problemaDoCliente(nome: string, d: { status: string; resumo: string }): string | null {
  if (d.status !== "erro" && d.status !== "pendente") return null;
  const oQue = d.status === "pendente" ? "ficou pendente" : "deu erro";
  return `${nome}: consulta ${oQue} — ${d.resumo}`.slice(0, 500);
}

/** Linhas "pendente" criadas antes disto são varridas para erro. */
export function corteVarredura(agora = new Date()): string {
  return new Date(agora.getTime() - PENDENTE_MAX_MS).toISOString();
}
