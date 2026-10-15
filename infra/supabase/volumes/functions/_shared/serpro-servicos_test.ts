// Testes com respostas simuladas do gateway (nada chama o Serpro).
//   deno test --allow-env _shared/serpro-servicos_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  analisarProcuracao,
  custoDoDesfecho,
  interpretarCaixaPostal,
  interpretarParcelamentos,
  interpretarProcuracao,
} from "./serpro-servicos.ts";
import type { ResultadoGateway } from "./serpro.ts";

const base = (x: Partial<ResultadoGateway>): ResultadoGateway => ({
  ok: true, serpro_http: 200, processando: false, tempo_espera: null, protocolo: null, mensagens: [], dados: null, pdfs: [], ...x,
});

Deno.test("caixa postal: importante = não lida + assunto de intimação", () => {
  const d = interpretarCaixaPostal(base({
    dados: { conteudo: [{ indicadorUltimaPagina: "S", listaMensagens: [
      { isn: 1, dataEnvio: "20260622", indicadorLeitura: "0", assuntoModelo: "Painel de Conformidade - Intimação", codigoSistemaRemetente: "00050" },
      { isn: 2, dataEnvio: "20260601", indicadorLeitura: "0", assuntoModelo: "Aviso e-Processo ++VARIAVEL++", valorParametroAssunto: "123" },
      { isn: 3, dataEnvio: "20260501", indicadorLeitura: "1", assuntoModelo: "Cobrança" },
    ] }] },
  }));
  assertEquals(d.status, "com_pendencia");
  const cx = (d.resultado as { caixaPostal: { total: number; naoLidas: number; importantes: number } }).caixaPostal;
  assertEquals([cx.total, cx.naoLidas, cx.importantes], [3, 2, 1]);
  assertEquals(custoDoDesfecho(d, "CAIXAPOSTAL"), 0.24);
});

Deno.test("parcelamentos: sem pedido é lista vazia", () => {
  const d = interpretarParcelamentos(base({ ok: false, serpro_http: 404, mensagens: [{ texto: "Não existe pedido de parcelamento para esse CNPJ" }] }), "PARCSN");
  assertEquals(d.status, "ok");
  assertEquals((d.resultado as { ativos: number }).ativos, 0);
});

Deno.test("parcelamentos: conta os ativos", () => {
  const d = interpretarParcelamentos(base({ dados: JSON.stringify({ parcelamentos: [
    { numero: 1, situacao: "Em parcelamento" }, { numero: 2, situacao: "Liquidado" },
  ] }) }), "PARCSN");
  assertEquals((d.resultado as { ativos: number }).ativos, 1);
});

Deno.test("procuração: vigente e vencida", () => {
  assertEquals(analisarProcuracao({ procuracoes: [{ dtexpiracao: "20991231", sistemas: ["1"] }] }).ativa, true);
  assertEquals(analisarProcuracao([{ dtexpiracao: "20200101" }]).ativa, false);
  assertEquals(interpretarProcuracao(base({ ok: false, serpro_http: 403 })).status, "com_pendencia");
});

Deno.test("custo: erro antes do Serpro não custa", () => {
  assertEquals(custoDoDesfecho({ status: "erro", resumo: "", resultado: { gatewayErro: "NAO_CONFIGURADO" } }, "SITFIS"), 0);
  assertEquals(custoDoDesfecho({ status: "ok", resumo: "", resultado: { serproHttp: 200, custoEstimado: 0.3 } }, "SITFIS"), 0.3);
});
