// Regra pura de "este aviso de certificado já foi resolvido?" (sem banco, testável).
//
// `CertificadoAviso` tem unique(certificadoId, marco) e a linha nasce ANTES do
// envio (é a trava). Só dois estados finais NÃO impedem outra tentativa, porque
// nenhuma mensagem chegou ao WAHA:
//   - sem_conexao: o WhatsApp do escritório estava fora;
//   - sem_telefone: o cliente estava sem telefone (ou sem WhatsApp). Quando o
//     cadastro é corrigido, o aviso sai no dia seguinte em vez de ficar
//     consumido para sempre.
// `enviado` e `falhou` consomem o marco (o WAHA pode ter enviado e só a
// resposta se perdeu; reenviar duplicaria).

export const STATUS_RETENTAVEIS = ["sem_conexao", "sem_telefone"] as const;

export function statusRetentavel(status: string): boolean {
  return (STATUS_RETENTAVEIS as readonly string[]).includes(status);
}

export type HistoricoAviso = { marco: number; status: string };

/**
 * `true` = não há nada a fazer hoje para este marco: já existe registro de um
 * marco MAIS PERTO do vencimento, ou do próprio marco num estado que não repete.
 */
export function avisoBloqueado(historico: HistoricoAviso[], marco: number): boolean {
  return historico.some((h) => h.marco < marco || (h.marco === marco && !statusRetentavel(h.status)));
}
