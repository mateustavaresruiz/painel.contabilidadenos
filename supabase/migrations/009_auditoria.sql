-- 009 · Auditoria: histórico de tudo o que acontece no painel
--
-- Idempotente e não destrutiva: só cria tabela, índices, funções, gatilhos e
-- uma permissão. Nenhuma linha existente é alterada ou apagada. O backfill do
-- fim copia fatos que JÁ estão gravados (transferências de atendimento e
-- abertura de chamados, com a data e o autor originais); nada é inventado.
--
--  1. "AuditoriaEvento": uma linha por acontecimento (quem, o quê, quando, com
--     o antes/depois dos campos que mudaram). Só os gatilhos escrevem; o
--     navegador nunca escreve e só lê com a permissão `auditoria.ver`.
--  2. Gatilhos (security definer) em chamados, clientes, sócios, certificados,
--     avisos, equipe, cargos, ajustes, atendimento do WhatsApp, vínculo de
--     cliente, etiquetas, consultas fiscais, agendamentos, números do WhatsApp.
--     De fora de propósito (volume): mensagens, "visto", presença, RateLimit.
--  3. O ator vem do login (auth.uid()). Nas Edge Functions (service role) vem do
--     header `x-painel-ator`, que o banco só aceita quando o papel é service_role.
--     Sem ator = "Sistema".
--  4. RPCs: historico_entidade (linha do tempo de um chamado, conversa ou
--     cliente, conferindo se quem pede já enxerga a entidade), comentar_chamado,
--     registrar_login, auditoria_evento (só service_role).
--  5. Retenção: guarda tudo, sem expurgo. Se a tabela crescer, o expurgo por
--     data (ex.: apagar > 2 anos) fica para uma migration futura e consciente.
--
-- Convenção do texto: "resumo" é uma frase SEM o nome de quem fez ("abriu o
-- chamado «X»"); a tela mostra "<ator> <resumo>". "detalhes" guarda só o que a
-- tela sabe desenhar: alteracoes [{campo, rotulo, de, para}], info [{rotulo,
-- valor}] e texto. Nunca segredo, token ou senha.

-- ---------------------------------------------------------------------------
-- 1. Tabela, índices e permissão
-- ---------------------------------------------------------------------------
create table if not exists public."AuditoriaEvento" (
  id              bigint generated always as identity primary key,
  "criadoEm"      timestamptz not null default now(),
  "tenantId"      text not null default 'denos',
  "atorId"        uuid references public."Colaborador"(id) on delete set null,
  "atorNome"      text,
  modulo          text not null,
  entidade        text not null,
  "entidadeId"    text,
  acao            text not null,
  resumo          text not null,
  detalhes        jsonb,
  origem          text not null default 'painel' check (origem in ('painel','sistema','whatsapp','cron')),
  -- Chaves de relação (sem FK, para o histórico sobreviver à exclusão):
  -- é por elas que a linha do tempo de cada tela é montada.
  "clienteId"     text,
  "chatId"        text,
  "solicitacaoId" text
);

create index if not exists "AuditoriaEvento_criadoEm_idx" on public."AuditoriaEvento"("criadoEm" desc, id desc);
create index if not exists "AuditoriaEvento_entidade_idx" on public."AuditoriaEvento"(entidade, "entidadeId", id desc);
create index if not exists "AuditoriaEvento_solicitacao_idx" on public."AuditoriaEvento"("solicitacaoId", id desc) where "solicitacaoId" is not null;
create index if not exists "AuditoriaEvento_chat_idx" on public."AuditoriaEvento"("chatId", id desc) where "chatId" is not null;
create index if not exists "AuditoriaEvento_cliente_idx" on public."AuditoriaEvento"("clienteId", id desc) where "clienteId" is not null;
create index if not exists "AuditoriaEvento_ator_idx" on public."AuditoriaEvento"("atorId", id desc) where "atorId" is not null;
create index if not exists "AuditoriaEvento_modulo_idx" on public."AuditoriaEvento"(modulo, id desc);
create index if not exists "AuditoriaEvento_resumo_trgm" on public."AuditoriaEvento" using gin (resumo gin_trgm_ops);

insert into public."Permissao" (chave, modulo, rotulo, descricao, ordem) values
  ('auditoria.ver', 'Configurações', 'Ver a auditoria',
   'Vê o histórico completo do painel: quem fez o quê e quando, em todos os módulos.', 81)
on conflict (chave) do nothing;

alter table public."AuditoriaEvento" enable row level security;
drop policy if exists auditoria_select on public."AuditoriaEvento";
create policy auditoria_select on public."AuditoriaEvento" for select to authenticated
  using ((select public.tem_permissao('auditoria.ver')));
revoke all on public."AuditoriaEvento" from anon, authenticated;
grant select on public."AuditoriaEvento" to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Peças internas (ninguém de fora chama)
-- ---------------------------------------------------------------------------

/** Quem está agindo: o login (auth.uid) ou, numa Edge Function, o header. */
create or replace function public.auditoria_ator_atual(p_fallback uuid default null)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null then
    select id into v_id from public."Colaborador" where "userId" = auth.uid() limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  if coalesce(auth.role(), '') = 'service_role' then
    begin
      v_id := nullif(current_setting('request.headers', true)::jsonb ->> 'x-painel-ator', '')::uuid;
    exception when others then
      v_id := null;
    end;
    if v_id is not null and exists (select 1 from public."Colaborador" where id = v_id) then
      return v_id;
    end if;
  end if;
  if p_fallback is not null and exists (select 1 from public."Colaborador" where id = p_fallback) then
    return p_fallback;
  end if;
  return null;
end $$;

/** Grava um evento. Nunca derruba a operação de quem chamou. */
create or replace function public.auditoria_registrar(
  p_modulo text, p_entidade text, p_entidade_id text, p_acao text, p_resumo text,
  p_detalhes jsonb default null, p_origem text default 'sistema',
  p_cliente text default null, p_chat text default null, p_solic text default null,
  p_ator uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_ator uuid;
  v_nome text;
  v_id bigint;
  v_det jsonb := p_detalhes;
begin
  -- Detalhe vazio (info sem nenhum par) não vira lixo na linha.
  if v_det ? 'info' and jsonb_array_length(v_det -> 'info') = 0 then
    v_det := v_det - 'info';
  end if;
  if v_det = '{}'::jsonb then v_det := null; end if;
  v_ator := public.auditoria_ator_atual(p_ator);
  if v_ator is not null then
    select nome into v_nome from public."Colaborador" where id = v_ator;
  end if;
  insert into public."AuditoriaEvento"
    ("atorId", "atorNome", modulo, entidade, "entidadeId", acao, resumo, detalhes, origem,
     "clienteId", "chatId", "solicitacaoId")
  values
    (v_ator, v_nome, p_modulo, p_entidade, p_entidade_id, p_acao, left(p_resumo, 1000), v_det,
     case when v_ator is not null then 'painel'
          when p_origem in ('painel','sistema','whatsapp','cron') then p_origem
          else 'sistema' end,
     p_cliente, p_chat, p_solic)
  returning id into v_id;
  return v_id;
exception when others then
  raise warning 'auditoria_registrar: %', sqlerrm;
  return null;
end $$;

create or replace function public.auditoria_valor(v jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(v) = 'string' and length(v #>> '{}') > 500
              then to_jsonb(left(v #>> '{}', 500) || '…') else v end $$;

/** [{campo, rotulo, de, para}] só dos campos de p_rotulos que mudaram. */
create or replace function public.auditoria_alteracoes(p_old jsonb, p_new jsonb, p_rotulos jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'campo', r.key, 'rotulo', r.value #>> '{}',
           'de', public.auditoria_valor(p_old -> r.key),
           'para', public.auditoria_valor(p_new -> r.key))
         order by r.ord), '[]'::jsonb)
    from jsonb_each(p_rotulos) with ordinality as r(key, value, ord)
   where (p_old -> r.key) is distinct from (p_new -> r.key) $$;

/** Uma alteração só, com texto já legível. */
create or replace function public.auditoria_alt(p_campo text, p_rotulo text, p_de text, p_para text)
returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('campo', p_campo, 'rotulo', p_rotulo, 'de', p_de, 'para', p_para)) $$;

/** [{rotulo, valor}] a partir de pares (rotulo, valor); valor vazio some. */
create or replace function public.auditoria_info(variadic p text[])
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('rotulo', p[i], 'valor', p[i + 1]) order by i), '[]'::jsonb)
    from generate_series(1, coalesce(array_length(p, 1), 0), 2) i
   where p[i + 1] is not null and p[i + 1] <> '' $$;

/** "Campo1, Campo2" dos rótulos de um array de alterações. */
create or replace function public.auditoria_lista_campos(p_alt jsonb)
returns text language sql immutable as $$
  select string_agg(a ->> 'rotulo', ', ') from jsonb_array_elements(p_alt) a $$;

create or replace function public.auditoria_cliente_nome(p_id text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim("nomeFantasia"), ''), nome) from public."Cliente" where id = p_id $$;

create or replace function public.auditoria_colab_nome(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select nome from public."Colaborador" where id = p_id $$;

create or replace function public.auditoria_chat_nome(p_id text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(nome), ''),
                  case when "chatId" like '%@c.us' then '+' || split_part("chatId", '@', 1)
                       else 'contato do WhatsApp' end)
    from public."WhatsappChat" where id = p_id $$;

create or replace function public.auditoria_sessao_nome(p_id text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(apelido), ''), numero, nome) from public."WhatsappSessao" where id = p_id $$;

create or replace function public.auditoria_dia(p date) returns text
language sql immutable as $$ select to_char(p, 'DD/MM/YYYY') $$;

/** Frase de uma linha de AtendimentoTransferencia (gatilho e backfill usam a mesma). */
create or replace function public.auditoria_resumo_atendimento(
  p_evento text, p_conversa text, p_de text, p_para text)
returns text language sql immutable as $$
  select case p_evento
    when 'assumiu'    then 'assumiu a conversa com ' || p_conversa
    when 'tomou'      then 'assumiu a conversa com ' || p_conversa || coalesce(' que estava com ' || p_de, '')
    when 'transferiu' then 'transferiu a conversa com ' || p_conversa
                           || coalesce(' de ' || p_de, '') || coalesce(' para ' || p_para, '')
    when 'devolveu'   then 'devolveu a conversa com ' || p_conversa || ' para a fila'
    when 'finalizou'  then 'finalizou o atendimento de ' || p_conversa
    when 'reabriu'    then 'reabriu o atendimento de ' || p_conversa
    when 'fila'       then 'a conversa com ' || p_conversa || ' voltou para a fila (nova mensagem do cliente)'
    else 'mudou o atendimento da conversa com ' || p_conversa
  end $$;

create or replace function public.auditoria_acao_atendimento(p_evento text) returns text
language sql immutable as $$
  select case when p_evento in ('assumiu','tomou','transferiu','devolveu','finalizou','reabriu','fila')
              then p_evento else 'transferiu' end $$;

-- Nada disto é para a tela.
revoke all on function public.auditoria_ator_atual(uuid) from public, anon, authenticated;
revoke all on function public.auditoria_registrar(text,text,text,text,text,jsonb,text,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.auditoria_valor(jsonb) from public, anon, authenticated;
revoke all on function public.auditoria_alteracoes(jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.auditoria_alt(text,text,text,text) from public, anon, authenticated;
revoke all on function public.auditoria_info(text[]) from public, anon, authenticated;
revoke all on function public.auditoria_lista_campos(jsonb) from public, anon, authenticated;
revoke all on function public.auditoria_cliente_nome(text) from public, anon, authenticated;
revoke all on function public.auditoria_colab_nome(uuid) from public, anon, authenticated;
revoke all on function public.auditoria_chat_nome(text) from public, anon, authenticated;
revoke all on function public.auditoria_sessao_nome(text) from public, anon, authenticated;
revoke all on function public.auditoria_dia(date) from public, anon, authenticated;
revoke all on function public.auditoria_resumo_atendimento(text,text,text,text) from public, anon, authenticated;
revoke all on function public.auditoria_acao_atendimento(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Gatilhos
-- ---------------------------------------------------------------------------

-- Chamados -------------------------------------------------------------------
create or replace function public.trg_auditoria_solicitacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public."Solicitacao";
  v_tipo text;
  v_cli text;
  v_de text;
  v_para text;
  v_st jsonb := jsonb_build_object('aberta','Aberta','em_andamento','Em andamento','concluida','Concluída','cancelada','Cancelada');
begin
  begin
    if tg_op = 'DELETE' then r := old; else r := new; end if;
    select nome into v_tipo from public."SolicitacaoTipo" where id = r."tipoId";
    v_tipo := coalesce(v_tipo, 'Chamado');
    v_cli := public.auditoria_cliente_nome(r."clienteId");

    if tg_op = 'INSERT' then
      perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'criado',
        'abriu o chamado «' || v_tipo || '»' || coalesce(' para ' || v_cli, '')
          || case when r."chatId" is not null then ' (pela conversa do WhatsApp)' else '' end,
        jsonb_build_object('info', public.auditoria_info(
          'Tipo', v_tipo, 'Cliente', v_cli, 'Status', v_st ->> r.status,
          'Responsável', public.auditoria_colab_nome(r."responsavelId"),
          'Prazo', public.auditoria_dia(r.prazo), 'Descrição', left(r.descricao, 500))),
        'sistema', r."clienteId", r."chatId", r.id, r."criadoPorId");

    elsif tg_op = 'DELETE' then
      perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'excluido',
        'excluiu o chamado «' || v_tipo || '»' || coalesce(' de ' || v_cli, ''),
        jsonb_build_object('info', public.auditoria_info(
          'Tipo', v_tipo, 'Cliente', v_cli, 'Status', v_st ->> r.status, 'Descrição', left(r.descricao, 500))),
        'sistema', r."clienteId", r."chatId", r.id);

    else
      if new.status is distinct from old.status then
        perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'status',
          'mudou o status do chamado «' || v_tipo || '» de ' || coalesce(v_st ->> old.status, old.status)
            || ' para ' || coalesce(v_st ->> new.status, new.status),
          jsonb_build_object('alteracoes', public.auditoria_alt('status', 'Status',
            v_st ->> old.status, v_st ->> new.status)),
          'sistema', r."clienteId", r."chatId", r.id);
      end if;
      if new."responsavelId" is distinct from old."responsavelId" then
        v_de := public.auditoria_colab_nome(old."responsavelId");
        v_para := public.auditoria_colab_nome(new."responsavelId");
        perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'responsavel',
          case when old."responsavelId" is null then 'definiu ' || coalesce(v_para, 'alguém') || ' como responsável pelo chamado «' || v_tipo || '»'
               when new."responsavelId" is null then 'tirou o responsável (' || coalesce(v_de, 'alguém') || ') do chamado «' || v_tipo || '»'
               else 'passou o chamado «' || v_tipo || '» de ' || coalesce(v_de, 'alguém') || ' para ' || coalesce(v_para, 'alguém') end,
          jsonb_build_object('alteracoes', public.auditoria_alt('responsavelId', 'Responsável', v_de, v_para)),
          'sistema', r."clienteId", r."chatId", r.id);
      end if;
      if new.prazo is distinct from old.prazo then
        perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'prazo',
          case when old.prazo is null then 'definiu o prazo do chamado «' || v_tipo || '» para ' || public.auditoria_dia(new.prazo)
               when new.prazo is null then 'tirou o prazo do chamado «' || v_tipo || '»'
               else 'mudou o prazo do chamado «' || v_tipo || '» de ' || public.auditoria_dia(old.prazo) || ' para ' || public.auditoria_dia(new.prazo) end,
          jsonb_build_object('alteracoes', public.auditoria_alt('prazo', 'Prazo',
            public.auditoria_dia(old.prazo), public.auditoria_dia(new.prazo))),
          'sistema', r."clienteId", r."chatId", r.id);
      end if;
      if new.descricao is distinct from old.descricao then
        perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'descricao',
          'editou a descrição do chamado «' || v_tipo || '»',
          jsonb_build_object('alteracoes', public.auditoria_alt('descricao', 'Descrição',
            left(old.descricao, 500), left(new.descricao, 500))),
          'sistema', r."clienteId", r."chatId", r.id);
      end if;
      if new."tipoId" is distinct from old."tipoId" then
        select nome into v_de from public."SolicitacaoTipo" where id = old."tipoId";
        perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'tipo',
          'mudou o tipo do chamado de «' || coalesce(v_de, '?') || '» para «' || v_tipo || '»',
          jsonb_build_object('alteracoes', public.auditoria_alt('tipoId', 'Tipo', v_de, v_tipo)),
          'sistema', r."clienteId", r."chatId", r.id);
      end if;
      if new."clienteId" is distinct from old."clienteId" then
        v_de := public.auditoria_cliente_nome(old."clienteId");
        perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'cliente',
          case when new."clienteId" is null then 'tirou o cliente (' || coalesce(v_de, '?') || ') do chamado «' || v_tipo || '»'
               when old."clienteId" is null then 'ligou o chamado «' || v_tipo || '» ao cliente ' || coalesce(v_cli, '?')
               else 'mudou o cliente do chamado «' || v_tipo || '» de ' || coalesce(v_de, '?') || ' para ' || coalesce(v_cli, '?') end,
          jsonb_build_object('alteracoes', public.auditoria_alt('clienteId', 'Cliente', v_de, v_cli)),
          'sistema', coalesce(new."clienteId", old."clienteId"), r."chatId", r.id);
      end if;
    end if;
  exception when others then
    raise warning 'trg_auditoria_solicitacao: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."Solicitacao";
create trigger trg_auditoria after insert or update or delete on public."Solicitacao"
  for each row execute function public.trg_auditoria_solicitacao();

-- Tipos de chamado -------------------------------------------------------------
create or replace function public.trg_auditoria_solicitacao_tipo() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_alt jsonb;
begin
  begin
    if tg_op = 'INSERT' then
      perform public.auditoria_registrar('chamados', 'tipo', new.id, 'criado',
        'criou o tipo de chamado «' || new.nome || '»', null);
    elsif tg_op = 'DELETE' then
      perform public.auditoria_registrar('chamados', 'tipo', old.id, 'excluido',
        'excluiu o tipo de chamado «' || old.nome || '»', null);
    else
      v_alt := public.auditoria_alteracoes(to_jsonb(old), to_jsonb(new),
        '{"nome":"Nome","descricao":"Descrição","ordem":"Ordem","ativo":"Ativo"}'::jsonb);
      if jsonb_array_length(v_alt) > 0 then
        perform public.auditoria_registrar('chamados', 'tipo', new.id,
          case when old.ativo is distinct from new.ativo and not new.ativo then 'desativado' else 'editado' end,
          case when old.ativo is distinct from new.ativo and not new.ativo then 'desativou o tipo de chamado «' || new.nome || '»'
               when old.ativo is distinct from new.ativo then 'reativou o tipo de chamado «' || new.nome || '»'
               else 'editou o tipo de chamado «' || new.nome || '» (' || public.auditoria_lista_campos(v_alt) || ')' end,
          jsonb_build_object('alteracoes', v_alt));
      end if;
    end if;
  exception when others then
    raise warning 'trg_auditoria_solicitacao_tipo: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."SolicitacaoTipo";
create trigger trg_auditoria after insert or update or delete on public."SolicitacaoTipo"
  for each row execute function public.trg_auditoria_solicitacao_tipo();

-- Clientes ---------------------------------------------------------------------
create or replace function public.trg_auditoria_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_nome text;
  v_alt jsonb;
  v_rot jsonb := '{"nome":"Nome / razão social","nomeFantasia":"Nome fantasia","tipo":"Tipo","cpfCnpj":"CPF/CNPJ","email":"E-mail","telefone":"Telefone","dataNascimento":"Data de nascimento","dataAbertura":"Data de abertura","regimeTributario":"Regime tributário","inscricaoEstadual":"Inscrição estadual","inscricaoMunicipal":"Inscrição municipal","cep":"CEP","rua":"Rua","numero":"Número","complemento":"Complemento","bairro":"Bairro","cidade":"Cidade","estado":"Estado","observacoes":"Observações"}'::jsonb;
begin
  begin
    if tg_op = 'INSERT' then
      v_nome := coalesce(nullif(trim(new."nomeFantasia"), ''), new.nome);
      perform public.auditoria_registrar('clientes', 'cliente', new.id, 'criado',
        case when new.provisorio then 'criou o cadastro provisório de ' || v_nome || ' (a partir do WhatsApp)'
             else 'cadastrou o cliente ' || v_nome end,
        jsonb_build_object('info', public.auditoria_info(
          'Tipo', case new.tipo when 'PF' then 'Pessoa física' else 'Pessoa jurídica' end,
          'CPF/CNPJ', new."cpfCnpj", 'Telefone', new.telefone, 'E-mail', new.email)),
        'sistema', new.id);

    elsif tg_op = 'DELETE' then
      v_nome := coalesce(nullif(trim(old."nomeFantasia"), ''), old.nome);
      perform public.auditoria_registrar('clientes', 'cliente', old.id, 'excluido',
        'excluiu o cliente ' || v_nome,
        jsonb_build_object('info', public.auditoria_info('CPF/CNPJ', old."cpfCnpj", 'Telefone', old.telefone)),
        'sistema', old.id);

    else
      v_nome := coalesce(nullif(trim(new."nomeFantasia"), ''), new.nome);
      if old.provisorio and not new.provisorio then
        perform public.auditoria_registrar('clientes', 'cliente', new.id, 'provisorio_completado',
          'completou o cadastro de ' || v_nome, null, 'sistema', new.id);
      end if;
      if old.ativo is distinct from new.ativo then
        perform public.auditoria_registrar('clientes', 'cliente', new.id,
          case when new.ativo then 'ativado' else 'desativado' end,
          case when new.ativo then 'reativou o cliente ' || v_nome else 'desativou o cliente ' || v_nome end,
          null, 'sistema', new.id);
      end if;
      v_alt := public.auditoria_alteracoes(to_jsonb(old), to_jsonb(new), v_rot);
      if jsonb_array_length(v_alt) > 0 then
        perform public.auditoria_registrar('clientes', 'cliente', new.id, 'editado',
          'editou o cadastro de ' || v_nome || ' (' || public.auditoria_lista_campos(v_alt) || ')',
          jsonb_build_object('alteracoes', v_alt), 'sistema', new.id);
      end if;
    end if;
  exception when others then
    raise warning 'trg_auditoria_cliente: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."Cliente";
create trigger trg_auditoria after insert or update or delete on public."Cliente"
  for each row execute function public.trg_auditoria_cliente();

-- Sócios -----------------------------------------------------------------------
create or replace function public.trg_auditoria_socio() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public."Socio";
  v_cli text;
  v_alt jsonb;
begin
  begin
    if tg_op = 'DELETE' then r := old; else r := new; end if;
    v_cli := public.auditoria_cliente_nome(r."clienteId");
    if tg_op = 'INSERT' then
      perform public.auditoria_registrar('clientes', 'socio', r.id, 'criado',
        'adicionou o sócio ' || r.nome || coalesce(' em ' || v_cli, ''),
        jsonb_build_object('info', public.auditoria_info('Participação', r.participacao::text, 'Telefone', r.telefone)),
        'sistema', r."clienteId");
    elsif tg_op = 'DELETE' then
      perform public.auditoria_registrar('clientes', 'socio', r.id, 'excluido',
        'removeu o sócio ' || r.nome || coalesce(' de ' || v_cli, ''), null, 'sistema', r."clienteId");
    else
      v_alt := public.auditoria_alteracoes(to_jsonb(old), to_jsonb(new),
        '{"nome":"Nome","cpf":"CPF","dataNascimento":"Data de nascimento","telefone":"Telefone","email":"E-mail","participacao":"Participação (%)","administrador":"Administrador"}'::jsonb);
      if jsonb_array_length(v_alt) > 0 then
        perform public.auditoria_registrar('clientes', 'socio', r.id, 'editado',
          'editou o sócio ' || r.nome || coalesce(' de ' || v_cli, '') || ' (' || public.auditoria_lista_campos(v_alt) || ')',
          jsonb_build_object('alteracoes', v_alt), 'sistema', r."clienteId");
      end if;
    end if;
  exception when others then
    raise warning 'trg_auditoria_socio: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."Socio";
create trigger trg_auditoria after insert or update or delete on public."Socio"
  for each row execute function public.trg_auditoria_socio();

-- Certificados digitais ------------------------------------------------------------
create or replace function public.trg_auditoria_certificado() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public."CertificadoDigital";
  v_cli text;
  v_alt jsonb;
begin
  begin
    if tg_op = 'DELETE' then r := old; else r := new; end if;
    v_cli := public.auditoria_cliente_nome(r."clienteId");
    if tg_op = 'INSERT' then
      perform public.auditoria_registrar('certificados', 'certificado', r.id, 'criado',
        'cadastrou o certificado ' || r.tipo || coalesce(' de ' || v_cli, '') || ' (vence em ' || public.auditoria_dia(r."validoAte") || ')',
        jsonb_build_object('info', public.auditoria_info('Titular', r.titular, 'Emissora', r.emissora,
          'Válido até', public.auditoria_dia(r."validoAte"))),
        'sistema', r."clienteId");
    elsif tg_op = 'DELETE' then
      perform public.auditoria_registrar('certificados', 'certificado', r.id, 'excluido',
        'excluiu o certificado ' || r.tipo || coalesce(' de ' || v_cli, ''),
        jsonb_build_object('info', public.auditoria_info('Válido até', public.auditoria_dia(r."validoAte"))),
        'sistema', r."clienteId");
    else
      v_alt := public.auditoria_alteracoes(to_jsonb(old), to_jsonb(new),
        '{"tipo":"Tipo","titular":"Titular","documento":"Documento","emissora":"Emissora","emitidoEm":"Emitido em","validoAte":"Válido até","telefoneAviso":"Telefone do aviso","avisarWhatsapp":"Avisar pelo WhatsApp","observacoes":"Observações"}'::jsonb);
      if jsonb_array_length(v_alt) > 0 then
        perform public.auditoria_registrar('certificados', 'certificado', r.id,
          case when old."validoAte" is distinct from new."validoAte" then 'validade' else 'editado' end,
          case when old."validoAte" is distinct from new."validoAte"
               then 'mudou a validade do certificado ' || r.tipo || coalesce(' de ' || v_cli, '') || ' para ' || public.auditoria_dia(new."validoAte")
               else 'editou o certificado ' || r.tipo || coalesce(' de ' || v_cli, '') || ' (' || public.auditoria_lista_campos(v_alt) || ')' end,
          jsonb_build_object('alteracoes', v_alt), 'sistema', r."clienteId");
      end if;
    end if;
  exception when others then
    raise warning 'trg_auditoria_certificado: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."CertificadoDigital";
create trigger trg_auditoria after insert or update or delete on public."CertificadoDigital"
  for each row execute function public.trg_auditoria_certificado();

-- Avisos de vencimento (um por marco, pelo cron) ---------------------------------------
create or replace function public.trg_auditoria_certificado_aviso() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cert public."CertificadoDigital";
  v_cli text;
begin
  begin
    select * into v_cert from public."CertificadoDigital" where id = new."certificadoId";
    v_cli := public.auditoria_cliente_nome(v_cert."clienteId");
    perform public.auditoria_registrar('certificados', 'certificado', new."certificadoId", 'aviso',
      case new.status
        when 'enviado' then 'enviou o aviso de vencimento (' || new.marco || ' dias) do certificado ' || coalesce(v_cert.tipo, '') || coalesce(' de ' || v_cli, '')
        when 'falhou' then 'não conseguiu enviar o aviso de vencimento (' || new.marco || ' dias) do certificado ' || coalesce(v_cert.tipo, '') || coalesce(' de ' || v_cli, '')
        when 'sem_telefone' then 'não enviou o aviso de vencimento do certificado ' || coalesce(v_cert.tipo, '') || coalesce(' de ' || v_cli, '') || ': sem telefone'
        else 'não enviou o aviso de vencimento do certificado ' || coalesce(v_cert.tipo, '') || coalesce(' de ' || v_cli, '') || ': sem conexão do WhatsApp'
      end,
      jsonb_build_object('info', public.auditoria_info('Marco', new.marco || ' dias', 'Telefone', new.telefone, 'Erro', left(new.erro, 300))),
      'cron', v_cert."clienteId");
  exception when others then
    raise warning 'trg_auditoria_certificado_aviso: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."CertificadoAviso";
create trigger trg_auditoria after insert on public."CertificadoAviso"
  for each row execute function public.trg_auditoria_certificado_aviso();

-- Equipe (pessoas) --------------------------------------------------------------------
create or replace function public.trg_auditoria_colaborador() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_de text;
  v_para text;
  v_alt jsonb;
begin
  begin
    if tg_op = 'INSERT' then
      select nome into v_para from public."Cargo" where id = new."cargoId";
      perform public.auditoria_registrar('equipe', 'colaborador', new.id::text, 'convidado',
        'convidou ' || new.nome || coalesce(' (cargo ' || v_para || ')', ''),
        jsonb_build_object('info', public.auditoria_info('E-mail', new.email, 'Cargo', v_para)));
    elsif tg_op = 'DELETE' then
      perform public.auditoria_registrar('equipe', 'colaborador', old.id::text, 'excluido',
        'excluiu ' || old.nome || ' da equipe',
        jsonb_build_object('info', public.auditoria_info('E-mail', old.email)));
    else
      if new."cargoId" is distinct from old."cargoId" then
        select nome into v_de from public."Cargo" where id = old."cargoId";
        select nome into v_para from public."Cargo" where id = new."cargoId";
        perform public.auditoria_registrar('equipe', 'colaborador', new.id::text, 'cargo',
          'mudou o cargo de ' || new.nome || ' de ' || coalesce(v_de, '?') || ' para ' || coalesce(v_para, '?'),
          jsonb_build_object('alteracoes', public.auditoria_alt('cargoId', 'Cargo', v_de, v_para)));
      end if;
      if new.ativo is distinct from old.ativo then
        perform public.auditoria_registrar('equipe', 'colaborador', new.id::text,
          case when new.ativo then 'ativado' else 'desativado' end,
          case when new.ativo then 'reativou o acesso de ' || new.nome else 'desativou o acesso de ' || new.nome end);
      end if;
      v_alt := public.auditoria_alteracoes(to_jsonb(old), to_jsonb(new),
        '{"nome":"Nome","email":"E-mail","telefone":"Telefone"}'::jsonb);
      if jsonb_array_length(v_alt) > 0 then
        perform public.auditoria_registrar('equipe', 'colaborador', new.id::text, 'editado',
          'editou os dados de ' || new.nome || ' (' || public.auditoria_lista_campos(v_alt) || ')',
          jsonb_build_object('alteracoes', v_alt));
      end if;
    end if;
  exception when others then
    raise warning 'trg_auditoria_colaborador: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."Colaborador";
create trigger trg_auditoria after insert or update or delete on public."Colaborador"
  for each row execute function public.trg_auditoria_colaborador();

-- Cargos e permissões -------------------------------------------------------------------
create or replace function public.trg_auditoria_cargo() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_add text;
  v_rem text;
  v_alt jsonb;
begin
  begin
    if tg_op = 'INSERT' then
      perform public.auditoria_registrar('equipe', 'cargo', new.id::text, 'criado',
        'criou o cargo «' || new.nome || '»',
        jsonb_build_object('info', public.auditoria_info('Permissões', coalesce(array_length(new.permissoes, 1), 0)::text)));
    elsif tg_op = 'DELETE' then
      perform public.auditoria_registrar('equipe', 'cargo', old.id::text, 'excluido',
        'excluiu o cargo «' || old.nome || '»');
    else
      if new.permissoes is distinct from old.permissoes then
        select string_agg(p.rotulo, ', ' order by p.ordem) into v_add
          from public."Permissao" p
         where p.chave = any(new.permissoes) and not (p.chave = any(old.permissoes));
        select string_agg(p.rotulo, ', ' order by p.ordem) into v_rem
          from public."Permissao" p
         where p.chave = any(old.permissoes) and not (p.chave = any(new.permissoes));
        perform public.auditoria_registrar('equipe', 'cargo', new.id::text, 'permissoes',
          'alterou as permissões do cargo «' || new.nome || '»',
          jsonb_build_object('info', public.auditoria_info('Passou a poder', v_add, 'Deixou de poder', v_rem)));
      end if;
      v_alt := public.auditoria_alteracoes(to_jsonb(old), to_jsonb(new), '{"nome":"Nome","descricao":"Descrição"}'::jsonb);
      if jsonb_array_length(v_alt) > 0 then
        perform public.auditoria_registrar('equipe', 'cargo', new.id::text, 'editado',
          'editou o cargo «' || new.nome || '» (' || public.auditoria_lista_campos(v_alt) || ')',
          jsonb_build_object('alteracoes', v_alt));
      end if;
    end if;
  exception when others then
    raise warning 'trg_auditoria_cargo: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."Cargo";
create trigger trg_auditoria after insert or update or delete on public."Cargo"
  for each row execute function public.trg_auditoria_cargo();

-- Ajustes (Config) e nome do escritório --------------------------------------------------
create or replace function public.trg_auditoria_config() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_chave text;
  v_old jsonb;
  v_new jsonb;
  v_rot jsonb := '{"modulos":"Módulos","marca.logo":"Logo do escritório","aparencia.estilo":"Estilo do painel","certificado.marcos":"Marcos dos avisos de certificado","certificado.sessaoId":"Número que envia os avisos de certificado","certificado.modelo":"Mensagem do aviso de certificado","serpro.ambiente":"Ambiente do Serpro"}'::jsonb;
  v_mod jsonb := '{"whatsapp":"WhatsApp","chamados":"Chamados","clientes":"Clientes e aniversários","certificados":"Certificados digitais","pendenciasFiscais":"Pendências fiscais","equipe":"Equipe","certificadosAvisos":"Avisos automáticos de certificado","aniversarioParabens":"Botão de parabéns de aniversário","chamadoNaConversa":"Abrir chamado na conversa","transferenciaAtendimento":"Transferência de atendimento","loginSemVerificacao":"Entrar só com o e-mail"}'::jsonb;
  v_nome text;
  v_alt jsonb;
  v_sens boolean;
  v_modulo text;
  v_de text;
  v_para text;
begin
  begin
    if tg_op = 'DELETE' then v_chave := old.chave; else v_chave := new.chave; end if;
    if tg_op <> 'INSERT' then v_old := old.valor; end if;
    if tg_op <> 'DELETE' then v_new := new.valor; end if;

    -- Gravou o mesmo valor: nada mudou.
    if tg_op = 'UPDATE' and v_old is not distinct from v_new then
      return null;
    end if;

    v_nome := coalesce(v_rot ->> v_chave, v_chave);
    v_modulo := case when v_chave like 'certificado.%' then 'certificados'
                     when v_chave like 'serpro.%' then 'pendencias'
                     else 'configuracoes' end;
    v_sens := v_chave ~* '(senha|token|secret|segredo|password|pin|api[_-]?key)';

    if v_chave = 'modulos' and tg_op = 'UPDATE'
       and jsonb_typeof(v_old) = 'object' and jsonb_typeof(v_new) = 'object' then
      select coalesce(jsonb_agg(jsonb_build_object(
               'campo', k, 'rotulo', coalesce(v_mod ->> k, k),
               'de', case v_old ->> k when 'true' then 'Ligado' when 'false' then 'Desligado' else coalesce(v_old ->> k, 'padrão') end,
               'para', case v_new ->> k when 'true' then 'Ligado' when 'false' then 'Desligado' else coalesce(v_new ->> k, 'padrão') end)
             order by k), '[]'::jsonb)
        into v_alt
        from (select jsonb_object_keys(v_old) k union select jsonb_object_keys(v_new)) s
       where (v_old -> k) is distinct from (v_new -> k);
      if jsonb_array_length(v_alt) > 0 then
        perform public.auditoria_registrar('configuracoes', 'config', v_chave, 'modulos',
          'mudou os módulos do painel (' || public.auditoria_lista_campos(v_alt) || ')',
          jsonb_build_object('alteracoes', v_alt));
      end if;
    elsif v_chave = 'marca.logo' then
      perform public.auditoria_registrar('configuracoes', 'config', v_chave, 'ajuste',
        case when tg_op = 'DELETE' then 'removeu a logo do escritório' else 'trocou a logo do escritório' end);
    else
      v_de := left(v_old #>> '{}', 500);
      v_para := left(v_new #>> '{}', 500);
      perform public.auditoria_registrar(v_modulo, 'config', v_chave, 'ajuste',
        case when tg_op = 'DELETE' then 'removeu o ajuste «' || v_nome || '»'
             else 'alterou o ajuste «' || v_nome || '»' end,
        case when v_sens or tg_op = 'DELETE' then null
             else jsonb_build_object('alteracoes', public.auditoria_alt(v_chave, v_nome, v_de, v_para)) end);
    end if;
  exception when others then
    raise warning 'trg_auditoria_config: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."Config";
create trigger trg_auditoria after insert or update or delete on public."Config"
  for each row execute function public.trg_auditoria_config();

create or replace function public.trg_auditoria_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.nome is distinct from old.nome then
      perform public.auditoria_registrar('configuracoes', 'config', 'tenant.nome', 'ajuste',
        'mudou o nome do escritório de «' || old.nome || '» para «' || new.nome || '»',
        jsonb_build_object('alteracoes', public.auditoria_alt('nome', 'Nome do escritório', old.nome, new.nome)));
    end if;
  exception when others then
    raise warning 'trg_auditoria_tenant: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."Tenant";
create trigger trg_auditoria after update on public."Tenant"
  for each row execute function public.trg_auditoria_tenant();

-- WhatsApp: atendimento (a tabela de transferências já é o registro único) -----------------
create or replace function public.trg_auditoria_atendimento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_chat text;
  v_cli text;
  v_de text;
  v_para text;
begin
  begin
    v_chat := coalesce(public.auditoria_chat_nome(new."chatId"), 'contato do WhatsApp');
    select "clienteId" into v_cli from public."WhatsappChat" where id = new."chatId";
    v_de := public.auditoria_colab_nome(new."deId");
    v_para := public.auditoria_colab_nome(new."paraId");
    perform public.auditoria_registrar('whatsapp', 'conversa', new."chatId",
      public.auditoria_acao_atendimento(new.evento),
      public.auditoria_resumo_atendimento(new.evento, v_chat, v_de, v_para),
      jsonb_build_object('info', public.auditoria_info(
        'Conversa', v_chat,
        'De', case when new.evento in ('transferiu','tomou') then v_de end,
        'Para', case when new.evento = 'transferiu' then v_para end,
        'Motivo', new.motivo)),
      'whatsapp', v_cli, new."chatId", null, new."porId");
  exception when others then
    raise warning 'trg_auditoria_atendimento: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."AtendimentoTransferencia";
create trigger trg_auditoria after insert on public."AtendimentoTransferencia"
  for each row execute function public.trg_auditoria_atendimento();

-- WhatsApp: cliente vinculado e conversa apagada -------------------------------------------
create or replace function public.trg_auditoria_whatsapp_chat() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_chat text;
  v_de text;
  v_para text;
begin
  begin
    v_chat := coalesce(public.auditoria_chat_nome(new.id), 'contato do WhatsApp');
    if new."clienteId" is distinct from old."clienteId" then
      v_de := public.auditoria_cliente_nome(old."clienteId");
      v_para := public.auditoria_cliente_nome(new."clienteId");
      perform public.auditoria_registrar('whatsapp', 'conversa', new.id,
        case when new."clienteId" is null then 'desvinculado' else 'vinculado' end,
        case when new."clienteId" is null then 'desvinculou a conversa com ' || v_chat || ' do cliente ' || coalesce(v_de, '(excluído)')
             when old."clienteId" is null then 'vinculou a conversa com ' || v_chat || ' ao cliente ' || coalesce(v_para, '?')
             else 'trocou o cliente da conversa com ' || v_chat || ' de ' || coalesce(v_de, '?') || ' para ' || coalesce(v_para, '?') end,
        jsonb_build_object('info', public.auditoria_info('Conversa', v_chat, 'Cliente', coalesce(v_para, v_de))),
        'whatsapp', coalesce(new."clienteId", old."clienteId"), new.id);
    end if;
    if old."apagadoEm" is null and new."apagadoEm" is not null then
      perform public.auditoria_registrar('whatsapp', 'conversa', new.id, 'apagada',
        'apagou a conversa com ' || v_chat, null, 'whatsapp', new."clienteId", new.id);
    end if;
  exception when others then
    raise warning 'trg_auditoria_whatsapp_chat: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."WhatsappChat";
create trigger trg_auditoria after update of "clienteId", "apagadoEm" on public."WhatsappChat"
  for each row execute function public.trg_auditoria_whatsapp_chat();

-- WhatsApp: etiquetas ------------------------------------------------------------------------
create or replace function public.trg_auditoria_chat_tag() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public."WhatsappChatTag";
  v_tag text;
  v_cli text;
  v_chat text;
begin
  begin
    if tg_op = 'DELETE' then r := old; else r := new; end if;
    select label into v_tag from public."WhatsappTag" where id = r."tagId";
    -- Conversa ou etiqueta apagadas (cascata): não é remoção feita por alguém.
    if v_tag is null or not exists (select 1 from public."WhatsappChat" where id = r."chatId") then
      return null;
    end if;
    v_chat := coalesce(public.auditoria_chat_nome(r."chatId"), 'contato do WhatsApp');
    select "clienteId" into v_cli from public."WhatsappChat" where id = r."chatId";
    perform public.auditoria_registrar('whatsapp', 'conversa', r."chatId",
      case when tg_op = 'INSERT' then 'etiqueta_aplicada' else 'etiqueta_removida' end,
      case when tg_op = 'INSERT' then 'aplicou a etiqueta «' || v_tag || '» na conversa com ' || v_chat
           else 'tirou a etiqueta «' || v_tag || '» da conversa com ' || v_chat end,
      jsonb_build_object('info', public.auditoria_info('Etiqueta', v_tag, 'Conversa', v_chat)),
      'whatsapp', v_cli, r."chatId");
  exception when others then
    raise warning 'trg_auditoria_chat_tag: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."WhatsappChatTag";
create trigger trg_auditoria after insert or delete on public."WhatsappChatTag"
  for each row execute function public.trg_auditoria_chat_tag();

create or replace function public.trg_auditoria_tag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.auditoria_registrar('whatsapp', 'etiqueta', new.id, 'etiqueta_criada',
        'criou a etiqueta «' || new.label || '»');
    elsif tg_op = 'DELETE' then
      perform public.auditoria_registrar('whatsapp', 'etiqueta', old.id, 'etiqueta_excluida',
        'excluiu a etiqueta «' || old.label || '»');
    elsif new.label is distinct from old.label or new.cor is distinct from old.cor then
      perform public.auditoria_registrar('whatsapp', 'etiqueta', new.id, 'etiqueta_editada',
        'editou a etiqueta «' || old.label || '»' || case when new.label is distinct from old.label then ' (agora «' || new.label || '»)' else '' end);
    end if;
  exception when others then
    raise warning 'trg_auditoria_tag: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."WhatsappTag";
create trigger trg_auditoria after insert or update or delete on public."WhatsappTag"
  for each row execute function public.trg_auditoria_tag();

-- WhatsApp: números (criar, apagar, conectar, desconectar) ------------------------------------
create or replace function public.trg_auditoria_sessao() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_nome text;
  v_acao text;
  v_resumo text;
begin
  begin
    if tg_op = 'INSERT' then
      v_nome := coalesce(nullif(trim(new.apelido), ''), new.numero, new.nome);
      perform public.auditoria_registrar('whatsapp', 'sessao', new.id, 'criada',
        'criou a conexão de WhatsApp «' || v_nome || '»', null, 'whatsapp');
    elsif tg_op = 'DELETE' then
      v_nome := coalesce(nullif(trim(old.apelido), ''), old.numero, old.nome);
      perform public.auditoria_registrar('whatsapp', 'sessao', old.id, 'apagada',
        'apagou a conexão de WhatsApp «' || v_nome || '»', null, 'whatsapp');
    else
      v_nome := coalesce(nullif(trim(new.apelido), ''), new.numero, new.nome);
      if new.status is distinct from old.status then
        if new.status = 'WORKING' then
          v_acao := 'conectou';
          v_resumo := 'conectou o número «' || v_nome || '»';
        elsif old.status = 'WORKING' and new.status = 'FAILED' then
          v_acao := 'desconectou';
          v_resumo := 'perdeu a conexão do número «' || v_nome || '» (falha)';
        elsif old.status = 'WORKING' then
          v_acao := 'desconectou';
          v_resumo := 'desconectou o número «' || v_nome || '»';
        end if;
        -- Queda e volta seguidas (reinício do WAHA) viram um evento só por janela.
        if v_acao is not null and not exists (
             select 1 from public."AuditoriaEvento"
              where entidade = 'sessao' and "entidadeId" = new.id and acao = v_acao
                and "criadoEm" > now() - interval '2 minutes') then
          perform public.auditoria_registrar('whatsapp', 'sessao', new.id, v_acao, v_resumo,
            jsonb_build_object('info', public.auditoria_info('Erro', left(new."ultimoErro", 300))), 'whatsapp');
        end if;
      end if;
      if new.apelido is distinct from old.apelido then
        perform public.auditoria_registrar('whatsapp', 'sessao', new.id, 'renomeada',
          'renomeou a conexão de WhatsApp para «' || v_nome || '»',
          jsonb_build_object('alteracoes', public.auditoria_alt('apelido', 'Nome', old.apelido, new.apelido)), 'whatsapp');
      end if;
    end if;
  exception when others then
    raise warning 'trg_auditoria_sessao: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."WhatsappSessao";
create trigger trg_auditoria after insert or delete or update of status, apelido on public."WhatsappSessao"
  for each row execute function public.trg_auditoria_sessao();

-- Pendências fiscais: consultas ------------------------------------------------------------------
create or replace function public.trg_auditoria_consulta() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cli text;
  v_serv text;
  v_origem text;
  v_st text;
begin
  begin
    v_cli := public.auditoria_cliente_nome(new."clienteId");
    v_serv := case new.servico
      when 'SITFIS' then 'a situação fiscal'
      when 'CAIXAPOSTAL' then 'a caixa postal'
      when 'PARCELAMENTOS' then 'os parcelamentos'
      when 'PROCURACAO' then 'a procuração'
      else 'o serviço ' || new.servico end;
    v_origem := case when new.origem = 'agendamento' then 'cron' else 'sistema' end;

    if tg_op = 'INSERT' then
      -- Consulta agendada é volume (todos os clientes, todo mês): só o resultado que importa.
      if new.origem <> 'agendamento' then
        perform public.auditoria_registrar('pendencias', 'consulta', new.id, 'consulta',
          'consultou ' || v_serv || coalesce(' de ' || v_cli, ''),
          jsonb_build_object('info', public.auditoria_info('Serviço', new.servico, 'Cliente', v_cli)),
          v_origem, new."clienteId", null, null, new."porId");
      end if;
    elsif old.status = 'pendente' and new.status <> 'pendente' then
      if new.origem = 'agendamento' and new.status = 'ok' then
        return null;
      end if;
      v_st := case new.status when 'ok' then 'sem pendências' when 'com_pendencia' then 'com pendências' else 'com erro' end;
      perform public.auditoria_registrar('pendencias', 'consulta', new.id, 'resultado',
        'consulta d' || v_serv || coalesce(' de ' || v_cli, '') || ' terminou ' || v_st
          || case when new.origem = 'agendamento' then ' (agendada)' else '' end,
        jsonb_build_object('info', public.auditoria_info('Resultado', left(new.resumo, 400),
          'Custo estimado', case when new."custoEstimado" is not null then 'R$ ' || to_char(new."custoEstimado", 'FM999990.00') end)),
        v_origem, new."clienteId", null, null, new."porId");
    end if;
  exception when others then
    raise warning 'trg_auditoria_consulta: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."ConsultaFiscal";
create trigger trg_auditoria after insert or update of status on public."ConsultaFiscal"
  for each row execute function public.trg_auditoria_consulta();

-- Pendências fiscais: agendamento automático ---------------------------------------------------------
create or replace function public.trg_auditoria_agendamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_serv text;
begin
  begin
    v_serv := case new.servico
      when 'SITFIS' then 'situação fiscal'
      when 'CAIXAPOSTAL' then 'caixa postal'
      when 'PARCELAMENTOS' then 'parcelamentos'
      when 'PROCURACAO' then 'procuração'
      else new.servico end;
    if new.ativo is distinct from old.ativo then
      perform public.auditoria_registrar('pendencias', 'agendamento', new.id,
        case when new.ativo then 'agendamento_ligado' else 'agendamento_desligado' end,
        case when new.ativo then 'ligou o agendamento automático de ' || v_serv || ' (dia ' || new."diaMes" || ' de cada mês)'
             else 'desligou o agendamento automático de ' || v_serv end,
        null, 'sistema', null, null, null, new."alteradoPorId");
    elsif new."diaMes" is distinct from old."diaMes"
       or new."todosAtivos" is distinct from old."todosAtivos"
       or new."clienteIds" is distinct from old."clienteIds" then
      perform public.auditoria_registrar('pendencias', 'agendamento', new.id, 'agendamento_editado',
        'mudou o agendamento automático de ' || v_serv,
        jsonb_build_object('info', public.auditoria_info(
          'Dia do mês', new."diaMes"::text,
          'Clientes', case when new."todosAtivos" then 'Todos os ativos'
                           else coalesce(array_length(new."clienteIds", 1), 0) || ' selecionados' end)),
        'sistema', null, null, null, new."alteradoPorId");
    end if;
  exception when others then
    raise warning 'trg_auditoria_agendamento: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."AgendamentoSerpro";
create trigger trg_auditoria after update of ativo, "diaMes", "todosAtivos", "clienteIds" on public."AgendamentoSerpro"
  for each row execute function public.trg_auditoria_agendamento();

revoke all on function public.trg_auditoria_solicitacao() from public, anon, authenticated;
revoke all on function public.trg_auditoria_solicitacao_tipo() from public, anon, authenticated;
revoke all on function public.trg_auditoria_cliente() from public, anon, authenticated;
revoke all on function public.trg_auditoria_socio() from public, anon, authenticated;
revoke all on function public.trg_auditoria_certificado() from public, anon, authenticated;
revoke all on function public.trg_auditoria_certificado_aviso() from public, anon, authenticated;
revoke all on function public.trg_auditoria_colaborador() from public, anon, authenticated;
revoke all on function public.trg_auditoria_cargo() from public, anon, authenticated;
revoke all on function public.trg_auditoria_config() from public, anon, authenticated;
revoke all on function public.trg_auditoria_tenant() from public, anon, authenticated;
revoke all on function public.trg_auditoria_atendimento() from public, anon, authenticated;
revoke all on function public.trg_auditoria_whatsapp_chat() from public, anon, authenticated;
revoke all on function public.trg_auditoria_chat_tag() from public, anon, authenticated;
revoke all on function public.trg_auditoria_tag() from public, anon, authenticated;
revoke all on function public.trg_auditoria_sessao() from public, anon, authenticated;
revoke all on function public.trg_auditoria_consulta() from public, anon, authenticated;
revoke all on function public.trg_auditoria_agendamento() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPCs
-- ---------------------------------------------------------------------------

/**
 * Linha do tempo de um chamado ('chamado'), de uma conversa ('conversa') ou de
 * um cliente ('cliente'). A tabela não é aberta: quem pede só recebe se já
 * enxerga a entidade (mesmas regras da RLS) ou tem `auditoria.ver`. Na ficha do
 * cliente, eventos de outros módulos só vêm para quem tem a permissão do módulo.
 */
create or replace function public.historico_entidade(
  p_entidade text, p_id text, p_limite integer default 100, p_antes bigint default null)
returns table (
  id bigint, "criadoEm" timestamptz, "atorId" uuid, "atorNome" text, modulo text,
  entidade text, "entidadeId" text, acao text, resumo text, detalhes jsonb, origem text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_eu uuid := public.eu_colaborador_id();
  v_admin boolean := public.tem_permissao('auditoria.ver');
  v_ok boolean := false;
  v_resp uuid;
  v_cri uuid;
  v_existe boolean;
  v_lim integer := least(greatest(coalesce(p_limite, 100), 1), 500);
begin
  if v_eu is null then
    raise exception 'Acesso não liberado.' using errcode = '42501';
  end if;
  if p_entidade not in ('chamado', 'conversa', 'cliente') then
    raise exception 'Entidade inválida.' using errcode = 'P0001';
  end if;

  if p_entidade = 'chamado' then
    select "responsavelId", "criadoPorId", true into v_resp, v_cri, v_existe
      from public."Solicitacao" where "Solicitacao".id = p_id;
    v_ok := coalesce(v_existe, false) and (public.tem_permissao('chamados.ver') or v_resp = v_eu or v_cri = v_eu);
  elsif p_entidade = 'conversa' then
    select "responsavelId", true into v_resp, v_existe from public."WhatsappChat" where "WhatsappChat".id = p_id;
    v_ok := coalesce(v_existe, false) and public.tem_permissao('whatsapp.ver')
            and (public.tem_permissao('whatsapp.ver_todas') or v_resp is null or v_resp = v_eu);
  else
    v_ok := public.tem_permissao('clientes.ver');
  end if;
  if not (v_ok or v_admin) then
    raise exception 'Sem acesso a este histórico.' using errcode = '42501';
  end if;

  return query
    select e.id, e."criadoEm", e."atorId", e."atorNome", e.modulo, e.entidade, e."entidadeId",
           e.acao, e.resumo, e.detalhes, e.origem
      from public."AuditoriaEvento" e
     where case p_entidade
             when 'chamado' then e."solicitacaoId" = p_id
             when 'conversa' then e."chatId" = p_id
             else e."clienteId" = p_id end
       and (p_antes is null or e.id < p_antes)
       and (p_entidade <> 'cliente' or v_admin or (
             case e.modulo
               when 'whatsapp' then public.tem_permissao('whatsapp.ver')
               when 'chamados' then public.tem_permissao('chamados.ver')
               when 'certificados' then public.tem_permissao('certificados.ver')
               when 'pendencias' then public.tem_alguma(array['serpro.consultar', 'clientes.ver'])
               else true end))
     order by e.id desc
     limit v_lim;
end $$;

/** Comentário no chamado: fica na linha do tempo (e na auditoria). */
create or replace function public.comentar_chamado(p_id text, p_texto text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := public.eu_colaborador_id();
  v_s public."Solicitacao";
  v_tipo text;
  v_texto text := trim(coalesce(p_texto, ''));
  v_id bigint;
begin
  if v_eu is null then
    raise exception 'Acesso não liberado.' using errcode = '42501';
  end if;
  select * into v_s from public."Solicitacao" where id = p_id;
  if not found then
    raise exception 'Chamado não encontrado.' using errcode = 'P0002';
  end if;
  if not (public.tem_permissao('chamados.ver') or v_s."responsavelId" = v_eu or v_s."criadoPorId" = v_eu) then
    raise exception 'Sem acesso a este chamado.' using errcode = '42501';
  end if;
  if length(v_texto) < 1 then
    raise exception 'Escreva o comentário.' using errcode = 'P0001';
  end if;
  if length(v_texto) > 2000 then
    raise exception 'O comentário passa de 2000 caracteres.' using errcode = 'P0001';
  end if;
  select nome into v_tipo from public."SolicitacaoTipo" where id = v_s."tipoId";
  v_id := public.auditoria_registrar('chamados', 'solicitacao', v_s.id, 'comentario',
    'comentou no chamado «' || coalesce(v_tipo, 'Chamado') || '»',
    jsonb_build_object('texto', v_texto), 'painel', v_s."clienteId", v_s."chatId", v_s.id, v_eu);
  return v_id;
end $$;

/** "Entrou no painel" (login por link ou código). Um por pessoa a cada 2 minutos. */
create or replace function public.registrar_login(p_metodo text default 'link')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := public.eu_colaborador_id();
begin
  if v_eu is null then return; end if;
  if exists (select 1 from public."AuditoriaEvento"
              where modulo = 'acesso' and "atorId" = v_eu and acao = 'login'
                and "criadoEm" > now() - interval '2 minutes') then
    return;
  end if;
  perform public.auditoria_registrar('acesso', 'colaborador', v_eu::text, 'login', 'entrou no painel',
    jsonb_build_object('info', public.auditoria_info('Como', case p_metodo
      when 'codigo' then 'Código de 6 números do e-mail'
      when 'email' then 'Só com o e-mail (sem verificação)'
      else 'Link de acesso' end)),
    'painel', null, null, null, v_eu);
end $$;

/** Para as Edge Functions (service_role): registra um evento que o gatilho não vê. */
create or replace function public.auditoria_evento(
  p_modulo text, p_entidade text, p_entidade_id text, p_acao text, p_resumo text,
  p_detalhes jsonb default null, p_cliente text default null, p_chat text default null,
  p_solic text default null, p_ator uuid default null, p_origem text default 'sistema')
returns bigint language sql security definer set search_path = public as $$
  select public.auditoria_registrar(p_modulo, p_entidade, p_entidade_id, p_acao, p_resumo,
                                    p_detalhes, p_origem, p_cliente, p_chat, p_solic, p_ator) $$;

revoke all on function public.historico_entidade(text,text,integer,bigint) from public, anon;
grant execute on function public.historico_entidade(text,text,integer,bigint) to authenticated;
revoke all on function public.comentar_chamado(text,text) from public, anon;
grant execute on function public.comentar_chamado(text,text) to authenticated;
revoke all on function public.registrar_login(text) from public, anon;
grant execute on function public.registrar_login(text) to authenticated;
revoke all on function public.auditoria_evento(text,text,text,text,text,jsonb,text,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.auditoria_evento(text,text,text,text,text,jsonb,text,text,text,uuid,text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Backfill (fatos já gravados, com a data e o autor originais; só na 1ª vez)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public."AuditoriaEvento" limit 1) then
    return;
  end if;

  -- Atendimento do WhatsApp: cada linha de AtendimentoTransferencia.
  insert into public."AuditoriaEvento"
    ("criadoEm", "atorId", "atorNome", modulo, entidade, "entidadeId", acao, resumo, detalhes, origem, "clienteId", "chatId")
  select t."criadoEm", t."porId", pc.nome, 'whatsapp', 'conversa', t."chatId",
         public.auditoria_acao_atendimento(t.evento),
         public.auditoria_resumo_atendimento(t.evento,
           coalesce(public.auditoria_chat_nome(t."chatId"), 'contato do WhatsApp'),
           public.auditoria_colab_nome(t."deId"), public.auditoria_colab_nome(t."paraId")),
         jsonb_build_object('info', public.auditoria_info('Motivo', t.motivo, 'Registro', 'Histórico anterior à auditoria')),
         case when t."porId" is null then 'whatsapp' else 'painel' end,
         c."clienteId", t."chatId"
    from public."AtendimentoTransferencia" t
    join public."WhatsappChat" c on c.id = t."chatId"
    left join public."Colaborador" pc on pc.id = t."porId"
   order by t."criadoEm";

  -- Chamados: a abertura de cada um.
  insert into public."AuditoriaEvento"
    ("criadoEm", "atorId", "atorNome", modulo, entidade, "entidadeId", acao, resumo, detalhes, origem, "clienteId", "chatId", "solicitacaoId")
  select s."criadoEm", s."criadoPorId", pc.nome, 'chamados', 'solicitacao', s.id, 'criado',
         'abriu o chamado «' || coalesce(tp.nome, 'Chamado') || '»'
           || coalesce(' para ' || public.auditoria_cliente_nome(s."clienteId"), '')
           || case when s."chatId" is not null then ' (pela conversa do WhatsApp)' else '' end,
         jsonb_build_object('info', public.auditoria_info(
           'Tipo', tp.nome, 'Cliente', public.auditoria_cliente_nome(s."clienteId"),
           'Prazo', public.auditoria_dia(s.prazo), 'Descrição', left(s.descricao, 500),
           'Registro', 'Histórico anterior à auditoria')),
         case when s."criadoPorId" is null then 'sistema' else 'painel' end,
         s."clienteId", s."chatId", s.id
    from public."Solicitacao" s
    left join public."SolicitacaoTipo" tp on tp.id = s."tipoId"
    left join public."Colaborador" pc on pc.id = s."criadoPorId"
   order by s."criadoEm";
end $$;

comment on table public."AuditoriaEvento" is
  'Histórico de tudo o que acontece no painel. Escrita só por gatilhos/RPCs; leitura com auditoria.ver ou por historico_entidade. Sem expurgo automático.';
