-- ===========================================================================
-- 005: login por e-mail (Supabase Auth, sem senha), cargos com permissões
-- (RBAC) e RLS de verdade.
--
-- Até a 004 o painel não tinha login: as políticas liberavam `anon` e a
-- proteção era a senha do domínio. A partir daqui:
--   - quem entra é um usuário do auth.users AMARRADO a um Colaborador ativo
--     ("Colaborador"."userId" = auth.uid());
--   - o que cada um pode fazer vem do CARGO dele ("Cargo".permissoes). O
--     cargo de sistema "Administrador" tem todas, não se edita nem se apaga;
--   - `anon` não lê nem escreve nada em public, nem chama RPC;
--   - toda política é `to authenticated` + `tem_permissao(...)`;
--   - escrita em Colaborador só pelo backend (function `equipe`), que confere
--     a permissão equipe.gerenciar.
-- Como funciona o login e como liberar alguém: docs/LOGIN.md.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Catálogo de permissões. A mesma lista mora no front
-- (apps/web/src/lib/permissoes.ts) para montar a tela de cargos; esta tabela
-- é a fonte que o banco usa para validar os cargos.
-- ---------------------------------------------------------------------------
create table public."Permissao" (
  chave     text primary key,
  modulo    text not null,
  rotulo    text not null,
  descricao text not null,
  ordem     integer not null default 0
);

insert into public."Permissao" (chave, modulo, rotulo, descricao, ordem) values
  ('whatsapp.ver',              'WhatsApp', 'Abrir o WhatsApp',          'Vê as conversas sem responsável e as suas.', 10),
  ('whatsapp.ver_todas',        'WhatsApp', 'Ver todas as conversas',    'Vê também as conversas de outras pessoas da equipe.', 11),
  ('whatsapp.responder',        'WhatsApp', 'Responder',                 'Envia mensagens, áudios e arquivos, reage e encaminha.', 12),
  ('whatsapp.assumir',          'WhatsApp', 'Assumir conversa',          'Fica como responsável por uma conversa sem responsável.', 13),
  ('whatsapp.transferir',       'WhatsApp', 'Transferir conversa',       'Passa a conversa para outra pessoa ou a devolve à fila.', 14),
  ('whatsapp.apagar_mensagens', 'WhatsApp', 'Apagar mensagens e conversas', 'Apaga mensagens enviadas e limpa ou remove conversas.', 15),
  ('whatsapp.exportar',         'WhatsApp', 'Exportar conversa',         'Baixa a conversa em PDF ou texto.', 16),
  ('whatsapp.conexoes',         'WhatsApp', 'Gerenciar números',         'Conecta, desconecta, cria e apaga as conexões do WhatsApp.', 17),
  ('chamados.ver',              'Chamados', 'Ver chamados',              'Vê todos os chamados. Sem ela, só os que criou ou dos quais é responsável.', 20),
  ('chamados.criar',            'Chamados', 'Abrir chamado',             'Abre chamados, inclusive pela conversa.', 21),
  ('chamados.gerenciar',        'Chamados', 'Gerenciar chamados',        'Muda status e responsável de qualquer chamado e exclui.', 22),
  ('chamados.tipos',            'Chamados', 'Tipos de chamado',          'Cria, edita e desativa os tipos de chamado.', 23),
  ('chamados.relatorio',        'Chamados', 'Relatório de chamados',     'Vê o relatório de tipos mais pedidos.', 24),
  ('clientes.ver',              'Clientes', 'Ver clientes',              'Abre a lista e a ficha dos clientes.', 30),
  ('clientes.editar',           'Clientes', 'Cadastrar e editar',        'Cadastra e altera clientes e sócios.', 31),
  ('clientes.excluir',          'Clientes', 'Excluir clientes',          'Exclui clientes (some o histórico ligado a eles).', 32),
  ('aniversarios.ver',          'Clientes', 'Ver aniversários',          'Abre a lista de aniversários de clientes e sócios.', 33),
  ('certificados.ver',          'Certificados', 'Ver certificados',      'Vê os certificados digitais e a validade.', 40),
  ('certificados.editar',       'Certificados', 'Cadastrar e editar',    'Cadastra, renova e exclui certificados.', 41),
  ('certificados.configurar_avisos', 'Certificados', 'Configurar avisos', 'Muda marcos, mensagem e número dos avisos de vencimento.', 42),
  ('serpro.consultar',          'Pendências fiscais', 'Consultar',       'Faz consultas ao Serpro e baixa os relatórios.', 50),
  ('serpro.confirmar_pin',      'Pendências fiscais', 'Confirmar com PIN', 'Confirma serviços do Serpro que pedem PIN (podem ter custo).', 51),
  ('dashboard.ver',             'Início', 'Ver números do escritório',   'Vê os indicadores e gráficos do Início.', 60),
  ('equipe.ver',                'Equipe', 'Ver equipe',                  'Abre a página Equipe.', 70),
  ('equipe.gerenciar',          'Equipe', 'Gerenciar equipe e cargos',   'Convida, edita, desativa pessoas e cria e edita cargos.', 71),
  ('configuracoes.gerenciar',   'Configurações', 'Configurações do painel', 'Módulos, integrações, marca e sistema.', 80);

-- ---------------------------------------------------------------------------
-- Cargos
-- ---------------------------------------------------------------------------
create table public."Cargo" (
  id             uuid primary key default gen_random_uuid(),
  "tenantId"     text not null default 'denos' references public."Tenant"(id),
  nome           text not null,
  descricao      text,
  permissoes     text[] not null default '{}',
  sistema        boolean not null default false,
  "criadoEm"     timestamptz not null default now(),
  "atualizadoEm" timestamptz not null default now()
);
create unique index "Cargo_nome_key" on public."Cargo"("tenantId", lower(nome));
create unique index "Cargo_sistema_key" on public."Cargo"("tenantId") where sistema;
create trigger trg_touch before update on public."Cargo" for each row execute function public.touch_atualizado_em();

insert into public."Cargo" (nome, descricao, permissoes, sistema) values
  ('Administrador', 'Acesso total ao painel. Não pode ser editado nem apagado.', '{}', true),
  ('Atendente', 'Atende no WhatsApp e abre chamados.', array[
     'whatsapp.ver','whatsapp.responder','whatsapp.assumir','whatsapp.transferir',
     'chamados.ver','chamados.criar','clientes.ver','aniversarios.ver','certificados.ver',
     'dashboard.ver','equipe.ver'], false),
  ('Contador', 'Atende, cuida dos clientes, certificados e consultas fiscais.', array[
     'whatsapp.ver','whatsapp.ver_todas','whatsapp.responder','whatsapp.assumir','whatsapp.transferir',
     'whatsapp.exportar','chamados.ver','chamados.criar','chamados.gerenciar','chamados.tipos',
     'chamados.relatorio','clientes.ver','clientes.editar','aniversarios.ver','certificados.ver',
     'certificados.editar','certificados.configurar_avisos','serpro.consultar','serpro.confirmar_pin',
     'dashboard.ver','equipe.ver'], false),
  ('Estagiário', 'Responde conversas e abre chamados, sem editar cadastros.', array[
     'whatsapp.ver','whatsapp.responder','chamados.ver','chamados.criar','clientes.ver',
     'aniversarios.ver','certificados.ver'], false);

-- Cargo de sistema: intocável pela tela. Permissões só do catálogo.
create or replace function public.cargo_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_invalidas text[];
begin
  if tg_op in ('UPDATE','DELETE') and old.sistema and current_user not in ('postgres','supabase_admin') then
    raise exception 'O cargo Administrador não pode ser alterado nem apagado.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public."Colaborador" where "cargoId" = old.id) then
      raise exception 'Há pessoas neste cargo. Mova-as para outro cargo antes de apagar.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' and new.sistema and current_user not in ('postgres','supabase_admin') then
    raise exception 'Cargo de sistema não pode ser criado pela tela.' using errcode = 'P0001';
  end if;
  new.nome := trim(new.nome);
  if length(new.nome) < 2 then
    raise exception 'Informe o nome do cargo.' using errcode = 'P0001';
  end if;
  select array_agg(p) into v_invalidas
    from unnest(new.permissoes) p
   where not exists (select 1 from public."Permissao" x where x.chave = p);
  if v_invalidas is not null then
    raise exception 'Permissão desconhecida: %', array_to_string(v_invalidas, ', ') using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct p order by p), '{}') into new.permissoes from unnest(new.permissoes) p;
  return new;
end $$;
create trigger trg_cargo_guard before insert or update or delete on public."Cargo"
  for each row execute function public.cargo_guard();

-- ---------------------------------------------------------------------------
-- Colaborador: papel e cargo (texto) dão lugar ao vínculo com Cargo.
-- ---------------------------------------------------------------------------
alter table public."Colaborador" add column "cargoId" uuid references public."Cargo"(id) on delete restrict;
update public."Colaborador" c set "cargoId" = (
  select id from public."Cargo" where nome = case when c.papel = 'admin' then 'Administrador' else 'Atendente' end);
update public."Colaborador" set "cargoId" = (select id from public."Cargo" where nome = 'Atendente') where "cargoId" is null;
alter table public."Colaborador" alter column "cargoId" set not null;
create index on public."Colaborador"("cargoId");

drop trigger if exists trg_colaborador_papel on public."Colaborador";
drop trigger if exists trg_colaborador_papel_del on public."Colaborador";
drop function if exists public.colaborador_papel_guard();
drop function if exists public.colaborador_papel_guard_delete();
alter table public."Colaborador" drop constraint if exists "Colaborador_papel_check";
alter table public."Colaborador" drop column papel;
alter table public."Colaborador" drop column cargo;

-- E-mail é a chave do login: um por pessoa.
create unique index if not exists "Colaborador_email_key"
  on public."Colaborador"(lower(email)) where email is not null;

-- Sempre pelo menos um colaborador ativo no cargo Administrador.
create or replace function public.colaborador_admin_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := (select id from public."Cargo" where sistema limit 1);
begin
  if old."cargoId" = v_admin and old.ativo
     and (tg_op = 'DELETE' or new."cargoId" <> v_admin or not new.ativo)
     and not exists (
       select 1 from public."Colaborador"
        where "cargoId" = v_admin and ativo and id <> old.id) then
    raise exception 'Precisa haver pelo menos um administrador ativo na equipe.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_colaborador_admin before update or delete on public."Colaborador"
  for each row execute function public.colaborador_admin_guard();

-- ---------------------------------------------------------------------------
-- Quem sou eu (pelo JWT). Security definer: leem Colaborador/Cargo sem
-- depender da RLS deles (que por sua vez usa estas funções).
-- ---------------------------------------------------------------------------
create or replace function public.eu_colaborador_id() returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from public."Colaborador" c
   where c."userId" = auth.uid() and c.ativo
   limit 1
$$;

create or replace function public.eu_colaborador_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public."Colaborador" c where c."userId" = auth.uid() and c.ativo)
$$;

/** Permissões efetivas de quem está logado (Administrador = catálogo inteiro). */
create or replace function public.minhas_permissoes() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when g.sistema then (select array_agg(chave order by ordem) from public."Permissao")
                else g.permissoes end
      from public."Colaborador" c join public."Cargo" g on g.id = c."cargoId"
     where c."userId" = auth.uid() and c.ativo
     limit 1), '{}')
$$;

create or replace function public.tem_permissao(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public."Colaborador" c join public."Cargo" g on g.id = c."cargoId"
     where c."userId" = auth.uid() and c.ativo and (g.sistema or p = any(g.permissoes)))
$$;

/** Qualquer uma da lista. */
create or replace function public.tem_alguma(p text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public."Colaborador" c join public."Cargo" g on g.id = c."cargoId"
     where c."userId" = auth.uid() and c.ativo and (g.sistema or g.permissoes && p))
$$;

-- ---------------------------------------------------------------------------
-- Políticas. Tudo `to authenticated`. `(select f())` faz o Postgres avaliar
-- a função uma vez por consulta, não por linha.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['Tenant','Colaborador','Cliente','Socio','WhatsappSessao','WhatsappChat',
    'WhatsappMensagem','WhatsappContato','WhatsappEventoLog','WhatsappTag','WhatsappChatTag',
    'AtendimentoTransferencia','SolicitacaoTipo','Solicitacao','CertificadoDigital','CertificadoAviso',
    'ConsultaFiscal','Config']
  loop
    execute format('drop policy if exists painel_select on public.%I', t);
    execute format('drop policy if exists painel_write on public.%I', t);
    execute format('drop policy if exists painel_update on public.%I', t);
  end loop;
end $$;
alter table public."Permissao" enable row level security;
alter table public."Cargo" enable row level security;

-- Básico de qualquer colaborador ativo: escritório, equipe, cargos, catálogo,
-- configuração (módulos ligados), tipos de chamado.
create policy painel_select on public."Tenant" for select to authenticated using ((select public.eu_colaborador_ativo()));
create policy painel_update on public."Tenant" for update to authenticated
  using ((select public.tem_permissao('configuracoes.gerenciar')))
  with check ((select public.tem_permissao('configuracoes.gerenciar')));
create policy painel_select on public."Colaborador" for select to authenticated using ((select public.eu_colaborador_ativo()));
create policy painel_select on public."Permissao" for select to authenticated using ((select public.eu_colaborador_ativo()));
create policy painel_select on public."Cargo" for select to authenticated using ((select public.eu_colaborador_ativo()));
create policy painel_write on public."Cargo" for all to authenticated
  using ((select public.tem_permissao('equipe.gerenciar')))
  with check ((select public.tem_permissao('equipe.gerenciar')));

create policy painel_select on public."Config" for select to authenticated using ((select public.eu_colaborador_ativo()));
create policy painel_write on public."Config" for all to authenticated
  using ((select public.tem_permissao('configuracoes.gerenciar'))
         or (chave like 'certificado.%' and (select public.tem_permissao('certificados.configurar_avisos'))))
  with check ((select public.tem_permissao('configuracoes.gerenciar'))
         or (chave like 'certificado.%' and (select public.tem_permissao('certificados.configurar_avisos'))));

create policy painel_select on public."SolicitacaoTipo" for select to authenticated using ((select public.eu_colaborador_ativo()));
create policy painel_write on public."SolicitacaoTipo" for all to authenticated
  using ((select public.tem_permissao('chamados.tipos'))) with check ((select public.tem_permissao('chamados.tipos')));

-- Clientes: o nome do cliente aparece em quase todo módulo (conversa,
-- certificado, chamado), então lê quem usa algum deles.
create policy painel_select on public."Cliente" for select to authenticated
  using ((select public.tem_alguma(array['clientes.ver','whatsapp.ver','chamados.ver','chamados.criar',
          'certificados.ver','serpro.consultar','aniversarios.ver','dashboard.ver'])));
create policy painel_insert on public."Cliente" for insert to authenticated
  with check ((select public.tem_permissao('clientes.editar')));
create policy painel_update on public."Cliente" for update to authenticated
  using ((select public.tem_permissao('clientes.editar'))) with check ((select public.tem_permissao('clientes.editar')));
create policy painel_delete on public."Cliente" for delete to authenticated
  using ((select public.tem_permissao('clientes.excluir')));

create policy painel_select on public."Socio" for select to authenticated
  using ((select public.tem_alguma(array['clientes.ver','aniversarios.ver'])));
create policy painel_write on public."Socio" for all to authenticated
  using ((select public.tem_permissao('clientes.editar'))) with check ((select public.tem_permissao('clientes.editar')));

-- WhatsApp. Sem whatsapp.ver_todas, só as conversas sem responsável e as suas.
create policy painel_select on public."WhatsappSessao" for select to authenticated
  using ((select public.tem_alguma(array['whatsapp.ver','whatsapp.conexoes','certificados.configurar_avisos'])));
create policy painel_select on public."WhatsappContato" for select to authenticated
  using ((select public.tem_permissao('whatsapp.ver')));
create policy painel_select on public."WhatsappEventoLog" for select to authenticated
  using ((select public.tem_permissao('configuracoes.gerenciar')));

create policy painel_select on public."WhatsappChat" for select to authenticated
  using ((select public.tem_permissao('whatsapp.ver')) and (
         (select public.tem_permissao('whatsapp.ver_todas'))
      or "responsavelId" is null or "responsavelId" = (select public.eu_colaborador_id())));
create policy painel_update on public."WhatsappChat" for update to authenticated
  using ((select public.tem_permissao('whatsapp.ver')) and (
         (select public.tem_permissao('whatsapp.ver_todas'))
      or "responsavelId" is null or "responsavelId" = (select public.eu_colaborador_id())))
  with check ((select public.tem_permissao('whatsapp.ver')));

create policy painel_select on public."WhatsappMensagem" for select to authenticated
  using ((select public.tem_permissao('whatsapp.ver')) and (
         (select public.tem_permissao('whatsapp.ver_todas'))
      or exists (select 1 from public."WhatsappChat" c
                  where c."tenantId" = "WhatsappMensagem"."tenantId"
                    and c."sessaoId" = "WhatsappMensagem"."sessaoId"
                    and c."chatId" = "WhatsappMensagem"."chatId"
                    and (c."responsavelId" is null or c."responsavelId" = (select public.eu_colaborador_id())))));

create policy painel_select on public."WhatsappTag" for select to authenticated using ((select public.tem_permissao('whatsapp.ver')));
create policy painel_write on public."WhatsappTag" for all to authenticated
  using ((select public.tem_permissao('whatsapp.responder'))) with check ((select public.tem_permissao('whatsapp.responder')));
create policy painel_select on public."WhatsappChatTag" for select to authenticated using ((select public.tem_permissao('whatsapp.ver')));
create policy painel_write on public."WhatsappChatTag" for all to authenticated
  using ((select public.tem_permissao('whatsapp.responder'))) with check ((select public.tem_permissao('whatsapp.responder')));
create policy painel_select on public."AtendimentoTransferencia" for select to authenticated
  using ((select public.tem_permissao('whatsapp.ver')));

-- Assumir x transferir: a coluna é a mesma ("responsavelId"), então quem
-- decide é este gatilho, valha a mudança pela tela ou pela RPC.
create or replace function public.whatsapp_chat_responsavel_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_eu uuid;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  if new."responsavelId" is not distinct from old."responsavelId" then return new; end if;
  v_eu := public.eu_colaborador_id();
  if old."responsavelId" is null and new."responsavelId" = v_eu then
    if not (public.tem_permissao('whatsapp.assumir') or public.tem_permissao('whatsapp.transferir')) then
      raise exception 'Sem permissão para assumir conversas.' using errcode = '42501';
    end if;
  elsif not public.tem_permissao('whatsapp.transferir') then
    raise exception 'Sem permissão para transferir conversas.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_whatsapp_chat_responsavel before update of "responsavelId" on public."WhatsappChat"
  for each row execute function public.whatsapp_chat_responsavel_guard();

-- Chamados. Sem chamados.ver, só os que criou ou dos quais é responsável.
create policy painel_select on public."Solicitacao" for select to authenticated
  using ((select public.tem_permissao('chamados.ver'))
      or ((select public.eu_colaborador_ativo()) and
          ("criadoPorId" = (select public.eu_colaborador_id()) or "responsavelId" = (select public.eu_colaborador_id()))));
create policy painel_insert on public."Solicitacao" for insert to authenticated
  with check ((select public.tem_permissao('chamados.criar')));
create policy painel_update on public."Solicitacao" for update to authenticated
  using ((select public.tem_permissao('chamados.gerenciar'))
      or ((select public.eu_colaborador_ativo()) and "responsavelId" = (select public.eu_colaborador_id())))
  with check ((select public.eu_colaborador_ativo()));
create policy painel_delete on public."Solicitacao" for delete to authenticated
  using ((select public.tem_permissao('chamados.gerenciar')));

-- Quem não gerencia só mexe no status do próprio chamado.
create or replace function public.solicitacao_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  if public.tem_permissao('chamados.gerenciar') then return new; end if;
  if new."responsavelId" is distinct from old."responsavelId"
     or new."tipoId" is distinct from old."tipoId"
     or new."clienteId" is distinct from old."clienteId"
     or new.prazo is distinct from old.prazo then
    raise exception 'Sem permissão para mudar responsável, tipo, cliente ou prazo do chamado.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_solicitacao_guard before update on public."Solicitacao"
  for each row execute function public.solicitacao_guard();

-- Certificados
create policy painel_select on public."CertificadoDigital" for select to authenticated
  using ((select public.tem_permissao('certificados.ver')));
create policy painel_write on public."CertificadoDigital" for all to authenticated
  using ((select public.tem_permissao('certificados.editar'))) with check ((select public.tem_permissao('certificados.editar')));
create policy painel_select on public."CertificadoAviso" for select to authenticated
  using ((select public.tem_permissao('certificados.ver')));

-- Consultas fiscais (escrita é do backend)
create policy painel_select on public."ConsultaFiscal" for select to authenticated
  using ((select public.tem_alguma(array['serpro.consultar','clientes.ver'])));

-- ---------------------------------------------------------------------------
-- Grants: anon fora de tudo em public; authenticated com o que já tinha.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- Colaborador: SÓ leitura pela tela. Convidar, editar, desativar e excluir
-- passam pela function `equipe` (service role), que confere a permissão.
revoke insert, update, delete, truncate on public."Colaborador" from authenticated;
grant select on public."Colaborador" to authenticated;
revoke insert, update, delete, truncate on public."Permissao" from authenticated;
grant select on public."Permissao" to authenticated;
grant select, insert, update, delete on public."Cargo" to authenticated;

revoke update on public."WhatsappChat" from anon, authenticated;
grant update (fixado, arquivado, "clienteId", "responsavelId", "atendimentoStatus", "atendimentoEm",
              "atualizadoEm", "clienteVinculoManual")
  on public."WhatsappChat" to authenticated;

revoke update on public."Tenant" from anon, authenticated;
grant update (nome) on public."Tenant" to authenticated;

grant select on public."Aniversario" to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.painel_exigir(p text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then return; end if;
  if p is null then
    if not public.eu_colaborador_ativo() then
      raise exception 'Acesso não liberado.' using errcode = '42501';
    end if;
  elsif not public.tem_permissao(p) then
    raise exception 'Sem permissão (%).', p using errcode = '42501';
  end if;
end $$;

-- Transferir: security definer (o histórico não tem política de insert) e o
-- "por" vem do login, não do cliente. Assumir/transferir confere o gatilho.
create or replace function public.transferir_atendimento(
  p_chat text, p_para uuid, p_por uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_de uuid;
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
  if p_para is not null and not exists (
    select 1 from public."Colaborador" where id = p_para and ativo) then
    raise exception 'Colaborador de destino não está ativo.' using errcode = 'P0001';
  end if;
  select "responsavelId" into v_de from public."WhatsappChat" where id = p_chat for update;
  if not found then raise exception 'conversa não encontrada'; end if;
  -- Quem não vê todas só mexe em conversa sem responsável ou sua.
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.tem_permissao('whatsapp.ver_todas')
     and v_de is not null and v_de <> v_por then
    raise exception 'Conversa de outra pessoa.' using errcode = '42501';
  end if;
  update public."WhatsappChat"
     set "responsavelId" = p_para,
         "atendimentoStatus" = case when p_para is null then 'aberto' else 'em_atendimento' end,
         "atendimentoEm" = now(), "atualizadoEm" = now()
   where id = p_chat;
  insert into public."AtendimentoTransferencia" ("chatId", "deId", "paraId", "porId", motivo)
  values (p_chat, v_de, p_para, v_por, nullif(trim(p_motivo), ''));
end $$;

-- As RPCs agregadas eram `language sql` sem conferência: o corpo original
-- vira *_dados (sem grant) e o nome público confere antes.
alter function public.painel_saude() rename to painel_saude_dados;
create or replace function public.painel_saude()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.painel_exigir(null);
  return public.painel_saude_dados();
end $$;

alter function public.painel_erros(integer) rename to painel_erros_dados;
create or replace function public.painel_erros(p_limite integer default 50)
returns table (id bigint, origem text, nivel text, mensagem text, stack text,
               contexto jsonb, rota text, status integer, "duracaoMs" integer, "criadoEm" timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.painel_exigir('configuracoes.gerenciar');
  return query select * from public.painel_erros_dados(p_limite);
end $$;

alter function public.painel_dashboard(timestamptz, timestamptz) rename to painel_dashboard_dados;
create or replace function public.painel_dashboard(p_de timestamptz, p_ate timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.painel_exigir('dashboard.ver');
  return public.painel_dashboard_dados(p_de, p_ate);
end $$;

alter function public.relatorio_solicitacoes(timestamptz, timestamptz) rename to relatorio_solicitacoes_dados;
create or replace function public.relatorio_solicitacoes(p_de timestamptz, p_ate timestamptz)
returns table ("tipoId" text, nome text, total bigint, abertas bigint, concluidas bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.painel_exigir('chamados.relatorio');
  return query select * from public.relatorio_solicitacoes_dados(p_de, p_ate);
end $$;

-- Desativar alguém derruba as sessões dele na hora (a function `equipe`
-- chama; o banimento no Auth impede o próximo login).
create or replace function public.revogar_sessoes(p_user uuid) returns integer
language plpgsql security definer set search_path = public, auth as $$
declare v int;
begin
  delete from auth.refresh_tokens where user_id = p_user::text;
  delete from auth.sessions where user_id = p_user;
  get diagnostics v = row_count;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Execute: anon fora de tudo; o que era público (PUBLIC) e não é gatilho
-- nem de extensão passa a ser só de authenticated e service_role.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from anon;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype <> 'trigger'::regtype
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and (p.proacl is null or exists (
             select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

-- Os que a tela não chama, mesmo logada.
revoke execute on function public.revogar_sessoes(uuid) from public, anon, authenticated;
grant execute on function public.revogar_sessoes(uuid) to service_role;
revoke execute on function public.painel_saude_dados() from public, anon, authenticated;
revoke execute on function public.painel_erros_dados(integer) from public, anon, authenticated;
revoke execute on function public.painel_dashboard_dados(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.relatorio_solicitacoes_dados(timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.transferir_atendimento(text, uuid, uuid, text) to authenticated;
grant execute on function public.painel_saude() to authenticated;
grant execute on function public.painel_erros(integer) to authenticated;
grant execute on function public.painel_dashboard(timestamptz, timestamptz) to authenticated;
grant execute on function public.relatorio_solicitacoes(timestamptz, timestamptz) to authenticated;
grant execute on function public.eu_colaborador_id() to authenticated;
grant execute on function public.eu_colaborador_ativo() to authenticated;
grant execute on function public.minhas_permissoes() to authenticated;
grant execute on function public.tem_permissao(text) to authenticated;
grant execute on function public.tem_alguma(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
drop policy if exists whatsapp_media_select on storage.objects;
drop policy if exists whatsapp_media_insert_uploads on storage.objects;
drop policy if exists consultas_fiscais_select on storage.objects;
drop policy if exists marca_select on storage.objects;
drop policy if exists marca_insert on storage.objects;
drop policy if exists marca_update on storage.objects;
drop policy if exists marca_delete on storage.objects;

create policy whatsapp_media_select on storage.objects for select to authenticated
  using (bucket_id = 'whatsapp-media' and (select public.tem_permissao('whatsapp.ver')));
create policy whatsapp_media_insert_uploads on storage.objects for insert to authenticated
  with check (bucket_id = 'whatsapp-media' and (storage.foldername(name))[2] = 'uploads'
              and (select public.tem_permissao('whatsapp.responder')));
create policy consultas_fiscais_select on storage.objects for select to authenticated
  using (bucket_id = 'consultas-fiscais' and (select public.tem_alguma(array['serpro.consultar','clientes.ver'])));
-- marca é bucket público: a URL pública da logo não passa por política.
create policy marca_select on storage.objects for select to authenticated
  using (bucket_id = 'marca' and (select public.eu_colaborador_ativo()));
create policy marca_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'marca' and (select public.tem_permissao('configuracoes.gerenciar')));
create policy marca_update on storage.objects for update to authenticated
  using (bucket_id = 'marca' and (select public.tem_permissao('configuracoes.gerenciar')))
  with check (bucket_id = 'marca' and (select public.tem_permissao('configuracoes.gerenciar')));
create policy marca_delete on storage.objects for delete to authenticated
  using (bucket_id = 'marca' and (select public.tem_permissao('configuracoes.gerenciar')));

-- Tempo real da equipe (troca de cargo reflete na hora).
alter publication supabase_realtime add table public."Colaborador";
alter publication supabase_realtime add table public."Cargo";
