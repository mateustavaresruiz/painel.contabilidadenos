import { z } from "zod";

import { isValidCep, isValidCpfCnpj, isValidTelefone } from "@/lib/masks";

const optionalString = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const optionalCpfCnpj = optionalString.refine(
  (v) => v === undefined || isValidCpfCnpj(v),
  { message: "CPF ou CNPJ inválido" },
);

const optionalTelefone = optionalString.refine(
  (v) => v === undefined || isValidTelefone(v),
  { message: "Telefone inválido" },
);

const optionalCep = optionalString.refine(
  (v) => v === undefined || isValidCep(v),
  { message: "CEP inválido" },
);

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((v) => (v === "" ? undefined : v))
  .refine((v) => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
    message: "E-mail inválido",
  });

// Data no formato do <input type="date"> (AAAA-MM-DD). Vazio → undefined.
export const optionalData = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v))
  .refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), {
    message: "Data inválida",
  });

export const REGIMES = [
  "MEI",
  "Simples Nacional",
  "Lucro Presumido",
  "Lucro Real",
  "Isenta",
  "Outro",
] as const;
export type RegimeTributario = (typeof REGIMES)[number];

/**
 * Cadastro de cliente do escritório contábil. Portado do adv3 e enxugado:
 * saiu a qualificação de procuração (RG, estado civil, profissão…), entraram
 * regime tributário e data de abertura (aniversário da empresa).
 */
export const clienteSchema = z.object({
  tipo: z.enum(["PF", "PJ"], { message: "Selecione PF ou PJ" }),
  nome: z.string().trim().min(2, "Informe o nome").max(200),
  nomeFantasia: optionalString,
  cpfCnpj: optionalCpfCnpj,
  email: optionalEmail,
  telefone: optionalTelefone,
  dataNascimento: optionalData,
  dataAbertura: optionalData,
  regimeTributario: z
    .enum(REGIMES)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  inscricaoEstadual: optionalString,
  inscricaoMunicipal: optionalString,
  cep: optionalCep,
  rua: optionalString,
  numero: optionalString,
  complemento: optionalString,
  bairro: optionalString,
  cidade: optionalString,
  estado: optionalString,
  observacoes: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  ativo: z.boolean(),
});

export type ClienteInput = z.infer<typeof clienteSchema>;
export type ClienteFormValues = z.input<typeof clienteSchema>;

export const ESTADOS_BR = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
