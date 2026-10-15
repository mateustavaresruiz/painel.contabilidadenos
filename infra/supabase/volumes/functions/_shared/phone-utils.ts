// Helpers de telefone — convenções brasileiras + JID do WhatsApp.

/**
 * Limpa formatação e devolve só dígitos.
 * "(11) 98765-4321" → "11987654321"
 */
export function onlyDigits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

/**
 * Detecta se um número brasileiro está sem o 9º dígito (formato antigo,
 * pré-2012). Aplica só pra DDD que usavam celular antes da mudança e
 * cujo primeiro dígito do número seria 6, 7, 8 ou 9.
 *
 * Exemplos:
 *   "553187604643"  → true  (DDD 31, primeiro dígito 8)
 *   "5531987604643" → false (já tem 9 dígitos no número)
 *   "551155556666"  → false (1º dígito 5, é fixo BR)
 */
export function isBrazilianMobileMissingNinthDigit(phone: string): boolean {
  const digits = onlyDigits(phone);
  if (digits.length !== 12 || !digits.startsWith("55")) return false;
  const firstDigitAfterDDD = parseInt(digits[4] ?? "0", 10);
  // 6-9 são prefixos de celular; 2-5 são fixos
  return firstDigitAfterDDD >= 6 && firstDigitAfterDDD <= 9;
}

/**
 * Se o número for um celular brasileiro sem o 9, adiciona. Caso contrário,
 * devolve o número como veio (só dígitos).
 *
 *   "553187604643"   → "5531987604643"
 *   "5531987604643"  → "5531987604643" (no-op)
 */
export function addNinthDigitIfNeeded(phone: string): string {
  const digits = onlyDigits(phone);
  if (!isBrazilianMobileMissingNinthDigit(digits)) return digits;
  return `${digits.slice(0, 4)}9${digits.slice(4)}`;
}

/**
 * Número de WhatsApp aceito na criação de instância: 55 + DDD + 8 ou 9
 * dígitos. O de 8 não é sobra de formulário mal preenchido: é o celular
 * anterior a 2012 que nunca ganhou o nono dígito e, principalmente, é a
 * linha FIXA em que o WhatsApp Business roda. Exigir 9 trancava esses
 * clientes do lado de fora sem nenhuma saída.
 */
export function numeroWhatsappValido(numero: string): boolean {
  const digits = onlyDigits(numero);
  return (
    (digits.length === 12 || digits.length === 13) &&
    digits.startsWith("55")
  );
}

/**
 * As grafias que representam o MESMO aparelho: o número como veio e, se
 * couber, a versão com ou sem o nono dígito.
 *
 * ⚠️ Mais estreita que `phoneVariants` de propósito. Lá tirar o 9 de
 * qualquer número de 13 dígitos é aceitável, porque o resultado só serve
 * pra procurar cadastro de cliente. Aqui ele decide se a instância vai pro
 * ar, e tirar o 9 de "5511953043084" produziria "551153043084" — que é o
 * FIXO (11) 5304-3084, outro número, de outra pessoa. Por isso a versão
 * curta só entra quando ela mesma é reconhecível como celular antigo.
 */
export function variantesNumeroWhatsapp(numero: string): string[] {
  const base = onlyDigits(numero);
  const variantes = new Set<string>([base]);
  if (isBrazilianMobileMissingNinthDigit(base)) {
    variantes.add(addNinthDigitIfNeeded(base));
  }
  if (base.length === 13 && base.startsWith("55") && base[4] === "9") {
    const semNono = `${base.slice(0, 4)}${base.slice(5)}`;
    if (isBrazilianMobileMissingNinthDigit(semNono)) variantes.add(semNono);
  }
  return Array.from(variantes);
}

/**
 * O número que conectou bate com o declarado? Compara pelas grafias com e
 * sem o nono dígito, porque o JID que o WhatsApp devolve nem sempre usa a
 * mesma que a pessoa digitou: quem declarava com o 9 e conectava um
 * aparelho registrado sem ele caía em FAILED por "número errado", sendo o
 * mesmo aparelho.
 */
export function mesmoNumeroWhatsapp(a: string, b: string): boolean {
  const da = onlyDigits(a), db = onlyDigits(b);
  if (!da || !db) return false;
  return variantesNumeroWhatsapp(da).includes(db) ||
    variantesNumeroWhatsapp(db).includes(da);
}

/**
 * Variações de um mesmo número pra usar em busca tolerante. Inclui:
 *   - número original (só dígitos)
 *   - com 9º dígito (se for BR sem 9)
 *   - sem 9º dígito (se for BR com 9 — pra casar com cadastros antigos)
 *
 * Útil pra encontrar `Cliente.telefone` no banco quando o WhatsApp manda
 * num formato e o usuário cadastrou em outro.
 */
export function phoneVariants(phone: string): string[] {
  const base = onlyDigits(phone);
  const variants = new Set<string>([base]);

  if (isBrazilianMobileMissingNinthDigit(base)) {
    variants.add(addNinthDigitIfNeeded(base));
  }

  // Inverso: número com 13 dígitos (55+DDD+9+8) → tenta também sem o 9.
  if (base.length === 13 && base.startsWith("55")) {
    const ddd = base.slice(2, 4);
    const restante = base.slice(4);
    if (restante[0] === "9") {
      variants.add(`55${ddd}${restante.slice(1)}`);
    }
  }

  return Array.from(variants);
}
