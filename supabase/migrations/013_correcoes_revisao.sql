-- 013 — Correções da revisão de código
--
--  1. Chamado criado pelo navegador: autor, data, origem e conclusão vêm do
--     BANCO, não do que a tela mandou (ninguém abre chamado "em nome" de outra
--     pessoa nem finge que veio do portal). Insert pela service role (function
--     do portal) continua igual.
--  2. Serpro agendado: trava por agendamento (`rodandoAte`) para duas execuções
--     do cron nunca processarem o mesmo ciclo ao mesmo tempo.
--  3. Portal: trocar o link é uma transação só (revoga os outros e grava o novo);
--     se a gravação falhar, o link anterior continua valendo.
--
-- Não destrutiva e idempotente: só `add column if not exists` e
-- `create or replace function`.

-- ---------------------------------------------------------------------------
-- 1. Chamado: campos de origem forçados no INSERT do navegador
-- ---------------------------------------------------------------------------
create or replace function public.solicitacao_conclusao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_logado boolean := coalesce(auth.role(), '') = 'authenticated';
begin
  if tg_op = 'INSERT' then
    if v_logado then
      -- O que o navegador mandou nesses campos é ignorado.
      new."criadoPorId" := public.eu_colaborador_id();
      new."criadoEm" := now();
      new.origem := case when new."chatId" is not null then 'whatsapp' else 'painel' end;
      new."concluidaEm" := case when new.status = 'concluida' then now() else null end;
    else
      new."concluidaEm" := case when new.status = 'concluida' then coalesce(new."concluidaEm", now()) else null end;
    end if;
    return new;
  end if;

  -- concluidaEm segue o status: vira concluída = agora; sai de concluída = limpa.
  if new.status is distinct from old.status then
    new."concluidaEm" := case when new.status = 'concluida' then now() else null end;
  elsif v_logado then
    new."concluidaEm" := old."concluidaEm";
  end if;

  -- Quem veio do navegador não reescreve a origem do chamado. Dentro de outro
  -- gatilho (ex.: a FK `on delete set null` ao apagar conversa ou colaborador)
  -- a troca para NULL continua valendo.
  if v_logado and pg_trigger_depth() <= 1 then
    if new."criadoEm" is distinct from old."criadoEm"
       or new."tenantId" is distinct from old."tenantId"
       or new.origem is distinct from old.origem
       or new."criadoPorId" is distinct from old."criadoPorId"
       or new."chatId" is distinct from old."chatId" then
      raise exception 'Origem do chamado (criação, autor, origem, conversa) não pode ser alterada.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.solicitacao_conclusao() from public, anon, authenticated;
drop trigger if exists trg_solicitacao_conclusao on public."Solicitacao";
create trigger trg_solicitacao_conclusao before insert or update on public."Solicitacao"
  for each row execute function public.solicitacao_conclusao();

-- ---------------------------------------------------------------------------
-- 2. Serpro agendado: trava por agendamento
-- ---------------------------------------------------------------------------
alter table public."AgendamentoSerpro" add column if not exists "rodandoAte" timestamptz;

-- Pega a trava se estiver livre (ou vencida) e devolve a linha atualizada;
-- nenhuma linha = outra execução está com o agendamento.
create or replace function public.agendamento_serpro_travar(p_id text, p_segundos integer default 300)
returns setof public."AgendamentoSerpro"
language sql security definer set search_path = public as $$
  update public."AgendamentoSerpro"
     set "rodandoAte" = now() + make_interval(secs => greatest(30, least(coalesce(p_segundos, 300), 900)))
   where id = p_id
     and ("rodandoAte" is null or "rodandoAte" < now())
  returning *;
$$;
revoke all on function public.agendamento_serpro_travar(text, integer) from public, anon, authenticated;
grant execute on function public.agendamento_serpro_travar(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Portal: troca atômica do link
-- ---------------------------------------------------------------------------
-- O índice "ClientePortalToken_ativo_key" (um link ativo por cliente) não deixa
-- o novo entrar antes de o anterior cair; aqui as duas coisas acontecem na
-- mesma transação: se o insert falhar, a revogação é desfeita junto.
create or replace function public.portal_token_trocar(
  p_cliente text, p_token_hash text, p_senha_hash text, p_expira timestamptz, p_por uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  update public."ClientePortalToken"
     set "revogadoEm" = now()
   where "clienteId" = p_cliente and "revogadoEm" is null;
  insert into public."ClientePortalToken" ("clienteId", "tokenHash", "senhaHash", "expiresAt", "criadoPorId")
  values (p_cliente, p_token_hash, p_senha_hash, p_expira, p_por)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.portal_token_trocar(text, text, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.portal_token_trocar(text, text, text, timestamptz, uuid) to service_role;
