// Regras da Central de alertas fiscais. Rodar: deno test apps/web/tests
import { assertEquals } from "jsr:@std/assert@1";

import {
  type ConsultaAlerta,
  type EmpresaAlerta,
  cobertura,
  csvDoAlerta,
  diasAte,
  montarAlertas,
  resumirAlertas,
} from "../src/lib/alertas-fiscais.ts";

const HOJE = new Date(2026, 10, 13, 10, 0, 0); // 13/11/2026

function consulta(servico: string, status: ConsultaAlerta["status"], resultado: Record<string, unknown> = {}, criadoEm = "2026-11-10T12:00:00Z", resumo: string | null = null): ConsultaAlerta {
  return { servico, status, resultado, criadoEm, resumo };
}

function empresa(id: string, ultimas: EmpresaAlerta["ultimas"] = {}, extra: Partial<EmpresaAlerta> = {}): EmpresaAlerta {
  return { id, nome: `Empresa ${id}`, nomeFantasia: null, cpfCnpj: "12345678000190", telefone: null, ultimas, pendentesPin: 0, certificadoValidoAte: null, ...extra };
}

const doAlerta = (es: EmpresaAlerta[], chave: string) => montarAlertas(es, HOJE).find((a) => a.chave === chave)!.itens.map((i) => i.clienteId);

Deno.test("diasAte conta dias de calendário", () => {
  assertEquals(diasAte("2026-11-13", HOJE), 0);
  assertEquals(diasAte("2026-12-13", HOJE), 30);
  assertEquals(diasAte("2026-11-12", HOJE), -1);
});

Deno.test("pendência no SITFIS mostra o primeiro trecho", () => {
  const e = empresa("a", { SITFIS: consulta("SITFIS", "com_pendencia", { trechos: ["Pendência - Débito DAS 09/2026", "Outro"] }) });
  const a = montarAlertas([e], HOJE).find((x) => x.chave === "sitfis_pendencia")!;
  assertEquals(a.itens.length, 1);
  assertEquals(a.itens[0].detalhe, "Pendência - Débito DAS 09/2026 (+1)");
});

Deno.test("sem procuração entra no alerta e sai de nunca consultadas", () => {
  const e = empresa("a", { PROCURACAO: consulta("PROCURACAO", "com_pendencia", { procuracao: "sem_procuracao" }) });
  assertEquals(doAlerta([e], "sem_procuracao"), ["a"]);
  assertEquals(doAlerta([e], "nunca_consultada"), []);
});

Deno.test("procuração vencendo: só ativa e dentro de 30 dias", () => {
  const p = (validade: string, procuracao = "ativa") => empresa(validade, { PROCURACAO: consulta("PROCURACAO", "ok", { procuracao, validade }) });
  const es = [p("2026-11-20"), p("2026-12-13"), p("2026-12-14"), p("2026-11-01"), p("2026-11-20", "sem_procuracao")];
  assertEquals(doAlerta(es, "procuracao_vencendo"), ["2026-11-20", "2026-12-13"]);
});

Deno.test("certificado vencido também alerta, o mais urgente primeiro", () => {
  const es = [
    empresa("longe", {}, { certificadoValidoAte: "2027-01-22" }),
    empresa("perto", {}, { certificadoValidoAte: "2026-11-30" }),
    empresa("vencido", {}, { certificadoValidoAte: "2026-11-01" }),
  ];
  assertEquals(doAlerta(es, "certificado_vencendo"), ["vencido", "perto"]);
});

Deno.test("caixa postal ordena por número de importantes", () => {
  const cp = (id: string, n: number) =>
    empresa(id, { CAIXAPOSTAL: consulta("CAIXAPOSTAL", n ? "com_pendencia" : "ok", { caixaPostal: { importantes: n, mensagens: [{ assunto: "Intimação", importante: true, naoLida: true }] } }) });
  assertEquals(doAlerta([cp("um", 1), cp("zero", 0), cp("tres", 3)], "caixa_importante"), ["tres", "um"]);
});

Deno.test("situação antiga passa de 35 dias", () => {
  const es = [
    empresa("velha", { SITFIS: consulta("SITFIS", "ok", {}, "2026-09-01T12:00:00Z") }),
    empresa("nova", { SITFIS: consulta("SITFIS", "ok", {}, "2026-11-01T12:00:00Z") }),
  ];
  assertEquals(doAlerta(es, "sitfis_desatualizada"), ["velha"]);
});

Deno.test("nunca consultada exige CPF/CNPJ", () => {
  assertEquals(doAlerta([empresa("com"), empresa("sem", {}, { cpfCnpj: null })], "nunca_consultada"), ["com"]);
});

Deno.test("resumo conta cada empresa uma vez e ignora gravidade baixa", () => {
  const es = [
    empresa("a", {
      SITFIS: consulta("SITFIS", "com_pendencia"),
      PROCURACAO: consulta("PROCURACAO", "com_pendencia", { procuracao: "sem_procuracao" }),
    }),
    empresa("b", { PARCELAMENTOS: consulta("PARCELAMENTOS", "ok", { ativos: 2 }) }),
    empresa("c", { DCTFWEB: consulta("DCTFWEB", "erro", {}, undefined, "Timeout") }),
  ];
  const r = resumirAlertas(montarAlertas(es, HOJE));
  assertEquals(r.empresasComProblema, 2);
  assertEquals(r.empresasGraves, 1);
  assertEquals(r.ativos.map((a) => a.chave), ["sitfis_pendencia", "sem_procuracao", "consulta_erro"]);
});

Deno.test("alertas saem na ordem de gravidade", () => {
  const g = montarAlertas([], HOJE).map((a) => a.gravidade);
  assertEquals(g, [...g].sort((x, y) => ["alta", "media", "baixa"].indexOf(x) - ["alta", "media", "baixa"].indexOf(y)));
});

Deno.test("cobertura usa a mesma prioridade do painel", () => {
  const es = [
    empresa("reg", { SITFIS: consulta("SITFIS", "ok") }),
    empresa("parc", { SITFIS: consulta("SITFIS", "com_pendencia"), PARCELAMENTOS: consulta("PARCELAMENTOS", "ok", { ativos: 1 }) }),
    empresa("pend", { SITFIS: consulta("SITFIS", "com_pendencia") }),
    empresa("err", { SITFIS: consulta("SITFIS", "erro") }),
    empresa("nunca"),
  ];
  assertEquals(cobertura(es), { regular: 1, com_pendencia: 1, parcelado: 1, erro: 1, nunca: 1 });
});

Deno.test("CSV com BOM, ponto e vírgula e aspas", () => {
  const e = empresa("a", { SITFIS: consulta("SITFIS", "com_pendencia", { trechos: ['Débito; "DAS"'] }) });
  const a = montarAlertas([e], HOJE).find((x) => x.chave === "sitfis_pendencia")!;
  assertEquals(csvDoAlerta(a), '﻿Empresa;CPF/CNPJ;Telefone;Detalhe\r\nEmpresa a;12345678000190;;"Débito; ""DAS"""');
});
