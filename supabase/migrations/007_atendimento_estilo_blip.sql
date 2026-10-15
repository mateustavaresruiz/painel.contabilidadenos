-- 007 · Atendimento no estilo Blip (fila → em atendimento → finalizado)
--
-- Idempotente e não destrutiva: só acrescenta (permissão, coluna, funções) ou
-- recria funções com `create or replace`. Nenhuma linha de conversa ou de
-- mensagem é apagada ou reescrita.
--
--  1. Permissão nova `whatsapp.assumir_de_outros` (supervisor) no catálogo
--     "Permissao" e nos cargos Contador (Administrador já tem todas).
--  2. "AtendimentoTransferencia".evento: tipo do registro na linha do tempo
--     (assumiu, tomou, transferiu, devolveu, finalizou, reabriu, fila).
--     Linhas antigas ficam com evento nulo; a tela deduz pelo de/para.
--  3. transferir_atendimento: quem não tem `assumir_de_outros` não toma
--     conversa que está com outra pessoa; grava o `evento`; assumir uma
--     conversa finalizada = reabrir.
--  4. finalizar_atendimento (nova): só o responsável (ou supervisor) finaliza.
--  5. atendimento_aplicar (nova, só service_role): troca de responsável/status
--     com checagem otimista, usada pelas Edge Functions ANTES de enviar.
--  6. whatsapp_chat_nova_mensagem: mensagem RECEBIDA numa conversa finalizada
--     devolve a conversa para a fila e registra "Voltou para a fila".
--  7. Fecha a escrita direta de responsável/status pelo navegador (passa só
--     pelas funções acima, que conferem as regras).

-- ---------------------------------------------------------------------------
-- 1. Permissão
-- ---------------------------------------------------------------------------
insert into public."Permissao" (chave, modulo, rotulo, descricao, ordem) values
  ('whatsapp.assumir_de_outros', 'WhatsApp', 'Assumir conversa de outra pessoa',
   'Supervisão: assume, finaliza e responde conversas que estão em atendimento por outra pessoa.', 14)
on conflict (chave) do nothing;

update public."Cargo"
   set permissoes = array_append(permissoes, 'whatsapp.assumir_de_outros')
 where nome = 'Contador' and not sistema
   and not ('whatsapp.assumir_de_outros' = any(permissoes));

-- ---------------------------------------------------------------------------
-- 2. Tipo do registro na linha do tempo
-- ---------------------------------------------------------------------------
alter table public."AtendimentoTransferencia" add column if not exists evento text;

do $$ begin
  alter table public."AtendimentoTransferencia"
    add constraint "AtendimentoTransferencia_evento_check"
    check (evento is null or evento in
      ('assumiu','tomou','transferiu','devolveu','finalizou','reabriu','fila'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Transferir / assumir (pela tela)
-- ---------------------------------------------------------------------------
create or replace function public.transferir_atendimento(
  p_chat text, p_para uuid, p_por uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_de uuid;
  v_status text;
  v_por uuid;
  v_evento text;
  v_motivo text := nullif(trim(p_motivo), '');
  v_nome_por text;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    v_por := p_por;
  else
    v_por := public.eu_colaborador_id();
    if v_por is null then
      raise exception 'Acesso não liberado.' using errcode = '42501';
    end if;
  end if;
  if p_para is not null and not exists (
    select 1 from public."Colaborador" where id = p_para and ativo) then
    raise exception 'Colaborador de destino não está ativo.' using errcode = 'P0001';
  end if;
  select "responsavelId", "atendimentoStatus" into v_de, v_status
    from public."WhatsappChat" where id = p_chat for update;
  if not found then raise exception 'conversa não encontrada'; end if;

  -- Conversa finalizada conta como livre (quem assume, reabre).
  if coalesce(auth.role(), '') <> 'service_role'
     and v_status <> 'finalizado'
     and v_de is not null and v_de <> v_por
     and not public.tem_permissao('whatsapp.assumir_de_outros') then
    raise exception 'Conversa em atendimento por outra pessoa.' using errcode = '42501';
  end if;

  -- Nada a fazer: já é dessa pessoa e está em atendimento.
  if v_status = 'em_atendimento' and v_de is not distinct from p_para and p_para is not null then
    return;
  end if;

  v_evento := case
    when p_para is null then 'devolveu'
    when v_status = 'finalizado' then 'reabriu'
    when v_de is null then 'assumiu'
    when p_para = v_por and v_de <> v_por then 'tomou'
    else 'transferiu'
  end;
  if v_evento = 'tomou' and v_motivo is null then
    select nome into v_nome_por from public."Colaborador" where id = v_por;
    v_motivo := 'Assumida por ' || coalesce(v_nome_por, 'supervisor');
  end if;

  update public."WhatsappChat"
     set "responsavelId" = p_para,
         "atendimentoStatus" = case when p_para is null then 'aberto' else 'em_atendimento' end,
         "atendimentoEm" = now(), "atualizadoEm" = now()
   where id = p_chat;
  insert into public."AtendimentoTransferencia" ("chatId", "deId", "paraId", "porId", motivo, evento)
  values (p_chat, v_de, p_para, v_por, v_motivo, v_evento);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Finalizar (pela tela)
-- ---------------------------------------------------------------------------
create or replace function public.finalizar_atendimento(
  p_chat text, p_por uuid default null, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_de uuid;
  v_status text;
  v_por uuid;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    v_por := p_por;
  else
    v_por := public.eu_colaborador_id();
    if v_por is null then
      raise exception 'Acesso não liberado.' using errcode = '42501';
    end if;
  end if;
  select "responsavelId", "atendimentoStatus" into v_de, v_status
    from public."WhatsappChat" where id = p_chat for update;
  if not found then raise exception 'conversa não encontrada'; end if;
  if v_status = 'finalizado' then return; end if;

  if coalesce(auth.role(), '') <> 'service_role' then
    if v_de is not null and v_de <> v_por and not public.tem_permissao('whatsapp.assumir_de_outros') then
      raise exception 'Só quem está com a conversa pode finalizar.' using errcode = '42501';
    end if;
    if v_de is null and not public.tem_permissao('whatsapp.responder') then
      raise exception 'Sem permissão para finalizar conversas.' using errcode = '42501';
    end if;
  end if;

  -- O responsável fica gravado (histórico: "finalizada por quem estava com ela");
  -- para o envio, conversa finalizada conta como livre.
  update public."WhatsappChat"
     set "atendimentoStatus" = 'finalizado', "atendimentoEm" = now(), "atualizadoEm" = now()
   where id = p_chat;
  insert into public."AtendimentoTransferencia" ("chatId", "deId", "paraId", "porId", motivo, evento)
  values (p_chat, v_de, v_de, v_por, nullif(trim(p_motivo), ''), 'finalizou');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Aplicação atômica pelas Edge Functions (service_role)
--    Só troca se a conversa ainda está como a function a leu (responsável e
--    status esperados). Senão devolve o estado atual e a function decide de novo.
-- ---------------------------------------------------------------------------
create or replace function public.atendimento_aplicar(
  p_chat text, p_por uuid, p_evento text, p_motivo text,
  p_esperado_resp uuid, p_esperado_status text,
  p_novo_resp uuid, p_novo_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_resp uuid;
  v_status text;
begin
  select "responsavelId", "atendimentoStatus" into v_resp, v_status
    from public."WhatsappChat" where id = p_chat for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sem_conversa');
  end if;
  if v_resp is distinct from p_esperado_resp or v_status <> p_esperado_status then
    return jsonb_build_object('ok', false, 'motivo', 'mudou',
                              'responsavelId', v_resp, 'status', v_status);
  end if;
  update public."WhatsappChat"
     set "responsavelId" = p_novo_resp, "atendimentoStatus" = p_novo_status,
         "atendimentoEm" = now(), "atualizadoEm" = now()
   where id = p_chat;
  insert into public."AtendimentoTransferencia" ("chatId", "deId", "paraId", "porId", motivo, evento)
  values (p_chat, v_resp, p_novo_resp, p_por, nullif(trim(p_motivo), ''), p_evento);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Mensagem recebida em conversa finalizada volta para a fila
--    (mesma assinatura da 002; a prévia e as não lidas seguem iguais).
--    Só vale para mensagem POSTERIOR à finalização: reentrega de mensagem
--    antiga não reabre nada.
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_chat_nova_mensagem(
  p_chat_id text, p_texto text, p_em timestamptz, p_from_me boolean, p_incrementar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_resp uuid;
  v_em timestamptz;
begin
  select "atendimentoStatus", "responsavelId", "atendimentoEm" into v_status, v_resp, v_em
    from public."WhatsappChat" where id = p_chat_id for update;

  update public."WhatsappChat" c set
    "ultimaMensagemTexto"  = case when c."ultimaMensagemEm" is null or p_em >= c."ultimaMensagemEm"
                                  then left(p_texto, 200) else c."ultimaMensagemTexto" end,
    "ultimaMensagemFromMe" = case when c."ultimaMensagemEm" is null or p_em >= c."ultimaMensagemEm"
                                  then p_from_me else c."ultimaMensagemFromMe" end,
    "ultimaMensagemEm"     = greatest(coalesce(c."ultimaMensagemEm", p_em), p_em),
    "naoLidas"             = c."naoLidas" + case when p_incrementar then 1 else 0 end,
    "atualizadoEm"         = now()
  where c.id = p_chat_id;

  if not p_from_me and v_status = 'finalizado' and (v_em is null or p_em >= v_em) then
    update public."WhatsappChat"
       set "atendimentoStatus" = 'aberto', "responsavelId" = null, "atendimentoEm" = now()
     where id = p_chat_id;
    insert into public."AtendimentoTransferencia" ("chatId", "deId", "paraId", "porId", motivo, evento)
    values (p_chat_id, v_resp, null, null, 'Voltou para a fila', 'fila');
  end if;
end $$;
revoke all on function public.whatsapp_chat_nova_mensagem(text,text,timestamptz,boolean,boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_chat_nova_mensagem(text,text,timestamptz,boolean,boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Permissões de execução e fechamento da escrita direta
-- ---------------------------------------------------------------------------
revoke all on function public.atendimento_aplicar(text,uuid,text,text,uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.atendimento_aplicar(text,uuid,text,text,uuid,text,uuid,text) to service_role;

revoke all on function public.finalizar_atendimento(text,uuid,text) from public, anon;
grant execute on function public.finalizar_atendimento(text,uuid,text) to authenticated, service_role;
grant execute on function public.transferir_atendimento(text,uuid,uuid,text) to authenticated;

-- Responsável e status só mudam pelas funções acima (que conferem as regras);
-- escrita direta pelo navegador deixaria furar o "em atendimento".
revoke update ("responsavelId", "atendimentoStatus", "atendimentoEm")
  on public."WhatsappChat" from authenticated;

-- ---------------------------------------------------------------------------
-- 8. Gatilho do responsável (005) conhece a permissão nova
--    Livre ou finalizada: assumir/transferir. Tomar de outra pessoa:
--    transferir ou assumir_de_outros. Devolver/passar adiante: transferir.
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_chat_responsavel_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_eu uuid;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  if new."responsavelId" is not distinct from old."responsavelId" then return new; end if;
  v_eu := public.eu_colaborador_id();
  if new."responsavelId" = v_eu and (old."responsavelId" is null or old."atendimentoStatus" = 'finalizado') then
    if not (public.tem_permissao('whatsapp.assumir') or public.tem_permissao('whatsapp.transferir')) then
      raise exception 'Sem permissão para assumir conversas.' using errcode = '42501';
    end if;
  elsif new."responsavelId" = v_eu and public.tem_permissao('whatsapp.assumir_de_outros') then
    null;
  elsif not public.tem_permissao('whatsapp.transferir') then
    raise exception 'Sem permissão para transferir conversas.' using errcode = '42501';
  end if;
  return new;
end $$;
