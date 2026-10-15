import { toast as sonner } from "sonner";

type Sonner = typeof sonner;
type PlainArgs = Parameters<Sonner>;

const noop = () => "" as string | number;

/**
 * Toast do app — fonte única. Envolve o `sonner` pra **engolir as
 * confirmações de sucesso**: "Salvo.", "Conversa apagada.", "Cliente
 * criado." e afins só poluíam a tela (decisão do dono, jul/2026). A tela
 * já mostra o resultado; um retângulo verde por cima não acrescenta nada.
 *
 * O que CONTINUA aparecendo, de propósito:
 * - `toast.error` / `toast.warning` / `toast.info` — o usuário precisa
 *   saber que algo falhou ou que a ação teve ressalva.
 *
 * 🔴 ONDE FICA A FRONTEIRA, porque errar nela apaga informação: o que morre é
 * a CONFIRMAÇÃO ("Salvo.", "Cliente criado."), que a tela já mostra sozinha.
 * O que NÃO pode morrer é RESULTADO — um número, uma contagem, um "restam N,
 * clique de novo", um "M ficaram para amanhã". Isso não está em lugar nenhum
 * da tela, e num `success` some sem deixar rastro: a pessoa aperta o botão,
 * o spinner roda e não acontece nada visível. Resultado é `info`; ressalva
 * dentro de um resultado é `warning`. Sete ações estavam mudas assim.
 * - `toast.loading` + `toast.dismiss` — feedback de trabalho em curso.
 * - toast com `action` (o "Desfazer" de `lib/undo.ts`) — sem o balão não
 *   existe onde clicar; sumir com ele mataria a funcionalidade.
 *
 * 🔴 E A PEGADINHA: quem tem `action` precisa ser `toast(...)`, a função
 * pura. `toast.success(…, { action })` NÃO passa — o `success` é no-op seco,
 * ele não olha as opções — e o botão simplesmente nunca existe. Dois lugares
 * caíram nisso, e o pior foi o `use-form-autosave`: o formulário voltava
 * preenchido com um rascunho velho, sem aviso e sem o "Descartar". O teste em
 * `toast.test.ts` agora reprova essa combinação.
 *
 * Por isso os arquivos importam `@/lib/toast`, não `sonner` direto. Um
 * import novo de `sonner` fura o filtro e traz o popup de volta.
 */
function toastFn(...args: PlainArgs) {
  const opts = args[1];
  // Sem botão pra clicar, é só confirmação — não mostra.
  if (!opts || !("action" in opts) || !opts.action) return noop();
  return sonner(...args);
}

export const toast = Object.assign(toastFn, sonner, {
  success: noop as Sonner["success"],
  message: toastFn as unknown as Sonner["message"],
});
