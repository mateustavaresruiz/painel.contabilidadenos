-- 023 — Pendências do módulo WhatsApp (revisão de 20/10/2026)
--
--  1. QR da conexão fora do alcance da tela: a coluna WhatsappSessao."qrCodeBase64"
--     deixa de ser legível por anon/authenticated (grant por coluna). Quem tinha
--     só whatsapp.ver lia o QR direto da tabela e podia vincular um aparelho à
--     conta do escritório. O QR continua saindo pela rota /qr da function
--     whatsapp, que exige whatsapp.conexoes.
--  2. Presença do contato (online, digitando, gravando, visto por último) numa
--     tabela própria, WhatsappPresenca. Na WhatsappChat cada "digitando" era uma
--     escrita na tabela que a lista de conversas assina, e todas as abas abertas
--     buscavam a lista de novo. As colunas antigas de WhatsappChat
--     ("presenceEstado", "presenceEm", "ultimoVistoEm") ficam, sem uso — tirá-las
--     é destrutivo e fica para depois.
--  3. Reação e voto de enquete atômicos: o webhook lia o json, alterava e
--     regravava; dois eventos juntos na mesma mensagem perdiam um deles. As RPCs
--     travam a linha (for update) e alteram dentro do banco.
--
-- Não destrutiva: nenhuma linha nem coluna apagada.

-- ---------------------------------------------------------------------------
-- 1. QR só pela function
-- ---------------------------------------------------------------------------
revoke select on public."WhatsappSessao" from anon, authenticated;
grant select (id, "tenantId", nome, apelido, numero, status, "pushName", "ultimoErro",
              "fotoPath", "fotoPersonalizada", "conectadoEm", "criadoEm", "atualizadoEm")
  on public."WhatsappSessao" to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Presença do contato
-- ---------------------------------------------------------------------------
create table if not exists public."WhatsappPresenca" (
  "conversaId"    text primary key references public."WhatsappChat"(id) on delete cascade,
  "tenantId"      text not null default 'denos' references public."Tenant"(id) on delete cascade,
  estado          text not null check (estado in ('online','offline','typing','recording')),
  "estadoEm"      timestamptz not null default now(),
  "ultimoVistoEm" timestamptz
);
alter table public."WhatsappPresenca" enable row level security;
revoke all on public."WhatsappPresenca" from anon, authenticated;
grant select on public."WhatsappPresenca" to authenticated;

-- A mesma regra da WhatsappChat: sem whatsapp.ver_todas, só conversa sem
-- responsável ou do próprio colaborador.
drop policy if exists painel_select on public."WhatsappPresenca";
create policy painel_select on public."WhatsappPresenca" for select to authenticated
  using ((select public.tem_permissao('whatsapp.ver')) and (
         (select public.tem_permissao('whatsapp.ver_todas'))
      or exists (select 1 from public."WhatsappChat" c
                  where c.id = "WhatsappPresenca"."conversaId"
                    and (c."responsavelId" is null or c."responsavelId" = (select public.eu_colaborador_id())))));

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public'
                    and tablename = 'WhatsappPresenca') then
    alter publication supabase_realtime add table public."WhatsappPresenca";
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Reação e voto atômicos (só o webhook, com service_role)
-- ---------------------------------------------------------------------------

-- Uma reação por autor: troca a anterior; emoji vazio retira.
create or replace function public.whatsapp_registrar_reacao(
  p_mensagem text, p_autor text, p_emoji text)
returns void language plpgsql security definer set search_path = public as $$
declare v_atual jsonb;
begin
  select reactions into v_atual from public."WhatsappMensagem" where id = p_mensagem for update;
  if not found then return; end if;
  if v_atual is null or jsonb_typeof(v_atual) <> 'array' then v_atual := '[]'::jsonb; end if;
  update public."WhatsappMensagem"
     set reactions =
           coalesce((select jsonb_agg(r order by i)
                       from jsonb_array_elements(v_atual) with ordinality as e(r, i)
                      where r->>'from' is distinct from coalesce(p_autor, '')), '[]'::jsonb)
           || case when coalesce(p_emoji, '') <> ''
                   then jsonb_build_array(jsonb_build_object('emoji', p_emoji, 'from', coalesce(p_autor, '')))
                   else '[]'::jsonb end
   where id = p_mensagem;
end $$;
revoke all on function public.whatsapp_registrar_reacao(text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_registrar_reacao(text, text, text) to service_role;

-- Escolha por votante (re-voto substitui, lista vazia retira) e `votes`
-- recalculado a partir de `voters`, como a tela espera.
create or replace function public.whatsapp_registrar_voto(
  p_mensagem text, p_votante text, p_opcoes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb;
  v_voters  jsonb;
  v_votes   jsonb;
begin
  select payload into v_payload from public."WhatsappMensagem" where id = p_mensagem for update;
  if not found then return; end if;
  if v_payload is null or jsonb_typeof(v_payload) <> 'object' then v_payload := '{}'::jsonb; end if;

  v_voters := coalesce(v_payload->'voters', '{}'::jsonb);
  if jsonb_typeof(v_voters) <> 'object' then v_voters := '{}'::jsonb; end if;
  v_voters := v_voters - p_votante;
  if jsonb_typeof(p_opcoes) = 'array' and jsonb_array_length(p_opcoes) > 0 then
    v_voters := v_voters || jsonb_build_object(p_votante, p_opcoes);
  end if;

  select coalesce(jsonb_object_agg(opcao, n), '{}'::jsonb) into v_votes
    from (select o.opcao, count(*) as n
            from jsonb_each(v_voters) as v(votante, escolhas)
           cross join lateral jsonb_array_elements_text(
                   case when jsonb_typeof(v.escolhas) = 'array' then v.escolhas else '[]'::jsonb end) as o(opcao)
           group by o.opcao) t;

  update public."WhatsappMensagem"
     set payload = v_payload || jsonb_build_object('voters', v_voters, 'votes', v_votes)
   where id = p_mensagem;
end $$;
revoke all on function public.whatsapp_registrar_voto(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_registrar_voto(text, text, jsonb) to service_role;
