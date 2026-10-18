import { toast as sonner, type ExternalToast } from "sonner";

type Sonner = typeof sonner;
type PlainArgs = Parameters<Sonner>;

const noop = () => "" as string | number;

/**
 * Toast do app — fonte única (os arquivos importam `@/lib/toast`, não `sonner`).
 *
 * Histórico: em jul/2026 o `success` virou no-op ("a tela já mostra o
 * resultado"). A revisão de usabilidade de out/2026 mostrou o contrário: sem
 * nenhum retorno a pessoa não sabe se a ação pegou e clica de novo. Agora o
 * `success` VOLTA, curto e discreto:
 *
 * - texto curto, sem ponto final ("Cliente salvo", "Chamado concluído");
 * - some sozinho em 2,5 s (erro e aviso ficam o tempo padrão, mais longo);
 * - sem botão de fechar (é só um "ok").
 *
 * Resultado (um número, "restam N") continua `info`; ressalva é `warning`;
 * falha é `error`. Toast com `action` (o "Desfazer") é `toast(...)` puro ou
 * qualquer variante com `action`: ganha 6 s para dar tempo de clicar.
 *
 * `toast(...)` puro SEM `action` segue mudo: era usado como "confirmação
 * genérica" e quem quer mostrar algo usa uma das variantes acima.
 */
function toastFn(...args: PlainArgs) {
  const opts = args[1];
  // Sem botão para clicar, é só confirmação genérica — não mostra.
  if (!opts || !("action" in opts) || !opts.action) return noop();
  return sonner(args[0], { duration: 6000, ...opts });
}

const SUCESSO: ExternalToast = { duration: 2500, closeButton: false };

function success(mensagem: Parameters<Sonner["success"]>[0], opts?: ExternalToast) {
  return sonner.success(mensagem, { ...SUCESSO, ...(opts?.action ? { duration: 6000 } : null), ...opts });
}

export const toast = Object.assign(toastFn, sonner, {
  success: success as Sonner["success"],
  message: toastFn as unknown as Sonner["message"],
});
