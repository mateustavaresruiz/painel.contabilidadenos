// Cache de contatos individuais (participantes de grupo). Cria/atualiza
// WhatsappContato com o melhor nome disponível (Cliente vinculado >
// pushName > telefone formatado) e dispara fetch da foto em background.
//
// Usado pelo webhook quando chega msg de grupo — pra cada remetente,
// garante que existe um WhatsappContato com nome+foto pra renderizar
// na bubble.

import { supabaseAdmin } from "./supabase.ts";
import * as waha from "./waha.ts";
import { ensureContatoPicture } from "./whatsapp-avatar.ts";
import { runAfterResponse } from "./background.ts";

/**
 * Acha o Cliente pelo telefone do WhatsApp via RPC `cliente_por_telefone`
 * (migration 001): compara o telefone NORMALIZADO do cadastro, tolerando o
 * 9º dígito. No adv3 a busca era `telefone ilike %dígitos%` sobre o texto
 * com máscara ("(44) 99701-8057") e quase nunca casava; o plano B dos
 * últimos 8 dígitos ignorava o DDD e escolhia um cliente qualquer (defeito
 * 25 do guia). Aqui não há plano B: sem casar, fica sem cliente.
 *
 * Mais de um cliente com o mesmo telefone = ambíguo, não vincula.
 */
export async function clientePorTelefone(
  numero: string,
): Promise<{ id: string; nome: string } | null> {
  const { data, error } = await supabaseAdmin.rpc("cliente_por_telefone", {
    p_telefone: numero,
  });
  if (error) {
    console.warn("[clientePorTelefone]", error.message);
    return null;
  }
  const rows = (data ?? []) as Array<{ id: string; nome: string; ativo?: boolean }>;
  const ativos = rows.filter((r) => r.ativo !== false);
  if (ativos.length !== 1) return null;
  return { id: ativos[0].id, nome: ativos[0].nome };
}

/**
 * Resolve LID → @c.us se necessário, faz upsert do WhatsappContato com
 * pushName e tenta vincular ao Cliente por telefone. Dispara busca da
 * foto em background (não bloqueante).
 *
 * Retorna o contatoId final (resolvido). Caller usa pra salvar como
 * `remetenteJid` na mensagem.
 */
export async function ensureContato(args: {
  tenantId: string;
  sessionName: string;
  /** Pode vir como @lid ou @c.us. */
  contatoId: string;
  pushName: string | null;
}): Promise<string> {
  let resolvedId = args.contatoId;
  // Quando o input vem como @lid e a resolução pra @c.us dá certo,
  // guardamos o LID original em `lidId` pra render de menções
  // (`@<lid_digits>` no texto). Sem isso o frontend não tem como
  // mapear o token cru pro nome do contato.
  let originalLid: string | null = null;

  // Resolve @lid → @c.us via WAHA (engine GOWS). Sem mapping, mantém
  // o @lid mesmo — caller verá um nome "Participante" e o contato
  // tenta resolver em batches futuros.
  //
  // ⚠️ Aqui a falha de infraestrutura é ENGOLIDA, ao contrário do
  // `handleMessage`, e a diferença é proposital: este LID é de um
  // PARTICIPANTE de grupo, onde a degradação já existe e é suave (nome
  // "Participante", resolve depois). Estourar faria o WAHA reentregar a
  // mensagem inteira por causa do nome de um membro.
  if (resolvedId.endsWith("@lid")) {
    originalLid = resolvedId;
    // Antes de perguntar ao WAHA: já conhecemos esse LID?
    const { data: conhecido } = await supabaseAdmin
      .from("WhatsappContato")
      .select("contatoId")
      .eq("tenantId", args.tenantId)
      .eq("lidId", resolvedId)
      .limit(1)
      .maybeSingle();
    let phone: string | null = conhecido?.contatoId ?? null;
    if (!phone) {
      try {
        phone = await waha.getPhoneFromLid({
          session: args.sessionName,
          lid: resolvedId,
        });
      } catch (err) {
        console.warn(
          "[ensureContato] LID sem resolver por falha de infraestrutura:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    if (phone) resolvedId = phone;
  }

  const numero =
    resolvedId.endsWith("@c.us")
      ? resolvedId.replace("@c.us", "")
      : null;

  // Tenta achar Cliente vinculado pra usar o nome dele. Sem match
  // (caso típico de membro de grupo que não é cliente), o pushName ou o
  // telefone formatado viram fallback no frontend.
  const cliente = numero ? await clientePorTelefone(numero) : null;

  // Upsert do contato. NÃO sobrescreve `nome` se já tem (preserva
  // edição manual futura). Se for a primeira aparição, seta `nome` com o
  // nome do Cliente.
  const { data: existing } = await supabaseAdmin
    .from("WhatsappContato")
    .select("id, nome, fotoPath")
    .eq("tenantId", args.tenantId)
    .eq("contatoId", resolvedId)
    .maybeSingle();

  const patch: Record<string, unknown> = {
    tenantId: args.tenantId,
    contatoId: resolvedId,
    numero,
    atualizadoEm: new Date().toISOString(),
  };
  // Só grava pushName quando VEIO um: no adv3 o null apagava o nome já
  // conhecido a cada mensagem (defeito 16 do guia).
  if (args.pushName) patch.pushName = args.pushName;
  if (!existing?.nome && cliente?.nome) patch.nome = cliente.nome;
  // Guarda o LID original só quando houve resolução real (mudou o
  // contatoId). Se o resolvedId continuou em @lid (WAHA não mapeou),
  // não popula — a chave é a mesma do contatoId, redundante.
  if (originalLid && resolvedId !== originalLid) {
    patch.lidId = originalLid;
  }

  const { error } = await supabaseAdmin
    .from("WhatsappContato")
    .upsert(patch, { onConflict: "tenantId,contatoId" });
  if (error) console.warn("[ensureContato] upsert", error.message);

  // Foto em background — não bloqueia a persistência da mensagem.
  // ensureContatoPicture é idempotente (pula se já tem fotoPath ou
  // se marcado como sem-foto).
  if (!existing?.fotoPath) {
    runAfterResponse(
      ensureContatoPicture({
        tenantId: args.tenantId,
        sessionName: args.sessionName,
        contatoId: resolvedId,
        fotoPathAtual: null,
      }),
      "ensureContato:foto",
    );
  }

  return resolvedId;
}
