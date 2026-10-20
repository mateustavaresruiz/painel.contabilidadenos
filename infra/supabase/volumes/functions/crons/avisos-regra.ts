// Regra pura de "este aviso de certificado já foi resolvido?" (sem banco, testável).
//
// `CertificadoAviso` tem unique(certificadoId, marco) e a linha nasce ANTES do
// envio (é a trava). Só dois estados finais NÃO impedem outra tentativa, porque
// nenhuma mensagem chegou ao WAHA:
//   - sem_conexao: o WhatsApp do escritório estava fora;
//   - sem_telefone: o cliente estava sem telefone (ou sem WhatsApp). Só repete
//     quando o cadastro muda (o telefone que seria usado hoje é outro): aí o
//     aviso sai no dia seguinte em vez de ficar consumido para sempre. Com o
//     mesmo cadastro, repetir todo dia só regravava a linha e a auditoria.
// `enviado` e `falhou` consomem o marco (o WAHA pode ter enviado e só a
// resposta se perdeu; reenviar duplicaria).

export const STATUS_RETENTAVEIS = ["sem_conexao", "sem_telefone"] as const;

export function statusRetentavel(status: string): boolean {
  return (STATUS_RETENTAVEIS as readonly string[]).includes(status);
}

/** `telefone`: o número da tentativa (com DDI), null quando não havia. */
export type HistoricoAviso = { marco: number; status: string; telefone?: string | null };

/**
 * `true` = não há nada a fazer hoje para este marco: já existe registro de um
 * marco MAIS PERTO do vencimento, ou do próprio marco num estado que não repete.
 * `telefoneAtual` é o número que seria usado hoje: um sem_telefone do próprio
 * marco com o mesmo número (ou de novo sem número) também bloqueia.
 */
export function avisoBloqueado(historico: HistoricoAviso[], marco: number, telefoneAtual?: string | null): boolean {
  return historico.some((h) => {
    if (h.marco < marco) return true;
    if (h.marco !== marco) return false;
    if (!statusRetentavel(h.status)) return true;
    return h.status === "sem_telefone" && telefoneAtual !== undefined && (h.telefone ?? null) === (telefoneAtual ?? null);
  });
}
