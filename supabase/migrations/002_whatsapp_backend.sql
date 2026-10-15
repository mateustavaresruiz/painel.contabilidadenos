-- ===========================================================================
-- 002: o que o backend do WhatsApp/Serpro (infra/supabase/volumes/functions)
-- precisa além do schema base. Ver os comentários das functions para o porquê
-- de cada peça; os números de defeito são do guia docs/chat-whatsapp/18 do adv3.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Log central de erro das functions. No self-hosted a API de logs do
-- Easypanel não funciona: esta tabela é onde um 500 deixa rastro legível.
-- Só o backend lê e escreve (RLS ligada, sem política).
-- ---------------------------------------------------------------------------
create table if not exists public."ErrorLog" (
  id           bigserial primary key,
  "tenantId"   text references public."Tenant"(id) on delete cascade,
  origem       text not null default 'edge',
  nivel        text not null default 'error' check (nivel in ('error','warn')),
  mensagem     text not null,
  stack        text,
  contexto     jsonb not null default '{}'::jsonb,
  rota         text,
  status       integer,
  "duracaoMs"  integer,
  "criadoEm"   timestamptz not null default now()
);
create index if not exists "ErrorLog_criadoEm_idx" on public."ErrorLog"("criadoEm" desc);
alter table public."ErrorLog" enable row level security;

-- ---------------------------------------------------------------------------
-- Log de eventos do webhook: nasce processado; o catch marca false + erro.
-- ---------------------------------------------------------------------------
alter table public."WhatsappEventoLog"
  add column if not exists processado boolean not null default true,
  add column if not exists erro text;
create index if not exists "WhatsappEventoLog_falhas_idx"
  on public."WhatsappEventoLog"("criadoEm" desc) where not processado;
create index if not exists "WhatsappEventoLog_sessao_idx" on public."WhatsappEventoLog"("sessaoId");

-- ---------------------------------------------------------------------------
-- Conversa:
--  - clienteVinculoManual: a tela desvinculou/vinculou à mão. Com true, o
--    vínculo automático por telefone nunca mexe no clienteId (defeito 1).
--  - perfilBuscadoEm: quando nome/sobre/foto foram perguntados ao WAHA. Sem
--    essa marca o adv3 refazia o perfil a cada mensagem (defeitos 12 e 26).
-- ---------------------------------------------------------------------------
alter table public."WhatsappChat"
  add column if not exists "clienteVinculoManual" boolean not null default false,
  add column if not exists "perfilBuscadoEm" timestamptz;
grant update ("clienteVinculoManual") on public."WhatsappChat" to anon, authenticated;

-- Busca por id curto (edição, revogação, citação: LIKE '%_<id>%').
create index if not exists "WhatsappMensagem_wamId_trgm"
  on public."WhatsappMensagem" using gin ("wamId" gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Eco do envio: casa o `message.any` fromMe com a linha provisória.
-- Agora também por TIPO quando não há texto (mídia sem legenda): no adv3 o
-- eco de uma foto sem legenda nunca casava e virava duplicata (defeito 14).
-- Duas fotos sem legenda enviadas no mesmo minuto podem trocar de wamId entre
-- si — as duas são do escritório, e o conteúdo de cada linha não muda.
-- ---------------------------------------------------------------------------
drop function if exists public.consumir_eco_fromme(text,text,text,text,integer,text);
create or replace function public.consumir_eco_fromme(
  p_tenant text, p_sessao text, p_chat text, p_wamid text, p_ack integer,
  p_texto text, p_tipo text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  update public."WhatsappMensagem" m
     set "wamId" = p_wamid, ack = greatest(m.ack, coalesce(p_ack, 1)), "pendenteEco" = false
   where m.id = (
     select id from public."WhatsappMensagem"
      where "tenantId" = p_tenant and "sessaoId" = p_sessao and "chatId" = p_chat
        and "fromMe" and "wamId" is null and "pendenteEco"
        and "criadoEm" > now() - interval '2 minutes'
        and (
              (p_texto is not null and texto = p_texto)
           or (p_texto is null and texto is null and p_tipo is not null
               and tipo = p_tipo and "mediaPath" is not null)
        )
      order by "criadoEm" asc for update skip locked limit 1)
     and "pendenteEco"
  returning m.id into v_id;
  return v_id is not null;
end $$;
revoke all on function public.consumir_eco_fromme(text,text,text,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.consumir_eco_fromme(text,text,text,text,integer,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- Prévia + não lidas numa escrita atômica, e a prévia só anda pra frente
-- (mensagem antiga reentregue não sobrescreve a mais nova — defeito 5).
-- O contador soma mesmo quando a prévia não muda (mensagem nova fora de ordem).
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_chat_nova_mensagem(
  p_chat_id text, p_texto text, p_em timestamptz, p_from_me boolean, p_incrementar boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public."WhatsappChat" c set
    "ultimaMensagemTexto"  = case when c."ultimaMensagemEm" is null or p_em >= c."ultimaMensagemEm"
                                  then left(p_texto, 200) else c."ultimaMensagemTexto" end,
    "ultimaMensagemFromMe" = case when c."ultimaMensagemEm" is null or p_em >= c."ultimaMensagemEm"
                                  then p_from_me else c."ultimaMensagemFromMe" end,
    "ultimaMensagemEm"     = greatest(coalesce(c."ultimaMensagemEm", p_em), p_em),
    "naoLidas"             = c."naoLidas" + case when p_incrementar then 1 else 0 end,
    "atualizadoEm"         = now()
  where c.id = p_chat_id;
end $$;
revoke all on function public.whatsapp_chat_nova_mensagem(text,text,timestamptz,boolean,boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_chat_nova_mensagem(text,text,timestamptz,boolean,boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Lista os objetos de um bucket por prefixo (a API do Storage só lista uma
-- pasta por vez). Usada pra apagar a mídia de UMA conversa ou instância.
-- ---------------------------------------------------------------------------
create or replace function public.storage_paths_por_prefixo(p_bucket text, p_prefixo text)
returns table (name text) language sql stable security definer set search_path = storage, public as $$
  select o.name from storage.objects o
   where o.bucket_id = p_bucket and o.name like replace(replace(p_prefixo, '%', '\%'), '_', '\_') || '%'
   limit 50000
$$;
revoke all on function public.storage_paths_por_prefixo(text, text) from public, anon, authenticated;
grant execute on function public.storage_paths_por_prefixo(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Bucket dos PDFs das consultas fiscais (relatório SITFIS, recibos).
-- Privado; a tela lê por URL assinada.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('consultas-fiscais', 'consultas-fiscais', false, 20971520)
on conflict (id) do nothing;

do $$ begin
  create policy consultas_fiscais_select on storage.objects for select to anon, authenticated
    using (bucket_id = 'consultas-fiscais');
exception when duplicate_object then null; end $$;

-- RateLimit é purgado por janela (job em 003).
create index if not exists "RateLimit_window_idx" on public."RateLimit"(window_start);
