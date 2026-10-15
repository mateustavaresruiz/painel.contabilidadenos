-- ===========================================================================
-- Painel Denos: schema base.
--
-- Escritório único. As tabelas mantêm a coluna "tenantId" (sempre 'denos')
-- para o código vindo do adv3 funcionar sem cirurgia e para o login, quando
-- vier, só precisar trocar as políticas abaixo.
--
-- 🔴 SEM LOGIN POR ENQUANTO (decisão do dono, 14/10/2026): as políticas
-- deixam o papel `anon` ler e mexer no que a tela precisa. A proteção hoje é
-- a senha (basic auth) do domínio do painel no Easypanel. Quando o login
-- entrar, troque `to anon, authenticated` por `to authenticated` e o
-- `using (true)` por `"tenantId" = get_my_tenant_id()`.
-- ===========================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Escritório e colaboradores
-- ---------------------------------------------------------------------------
create table public."Tenant" (
  id         text primary key,
  nome       text not null,
  "criadoEm" timestamptz not null default now()
);
insert into public."Tenant" (id, nome) values ('denos', 'Contabilidade Denos');

create or replace function public.get_my_tenant_id() returns text
  language sql immutable as $$ select 'denos'::text $$;

create or replace function public.fill_tenant_id() returns trigger
language plpgsql as $$
begin
  if new."tenantId" is null then new."tenantId" := 'denos'; end if;
  return new;
end $$;

-- Quem atende. Sem login, a tela escolhe "quem sou eu" numa lista.
-- "userId" fica pronto para amarrar ao auth.users quando o login vier.
create table public."Colaborador" (
  id             uuid primary key default gen_random_uuid(),
  "tenantId"     text not null default 'denos' references public."Tenant"(id),
  nome           text not null,
  email          text,
  telefone       text,
  cor            text not null default '#2563eb',
  cargo          text,
  ativo          boolean not null default true,
  "userId"       uuid unique,
  "criadoEm"     timestamptz not null default now(),
  "atualizadoEm" timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Clientes (empresas e pessoas) e sócios
-- ---------------------------------------------------------------------------
create table public."Cliente" (
  id                   text primary key default gen_random_uuid()::text,
  "tenantId"           text not null default 'denos' references public."Tenant"(id),
  tipo                 text not null default 'PJ' check (tipo in ('PF','PJ')),
  nome                 text not null,                 -- razão social (PJ) ou nome (PF)
  "nomeFantasia"       text,
  "cpfCnpj"            text,                          -- só dígitos
  email                text,
  telefone             text,                          -- como digitado
  "telefoneNormalizado" text,                         -- só dígitos com DDI, preenchido pelo gatilho
  "dataNascimento"     date,                          -- PF
  "dataAbertura"       date,                          -- PJ: aniversário da empresa
  "regimeTributario"   text check ("regimeTributario" in ('MEI','Simples Nacional','Lucro Presumido','Lucro Real','Isenta','Outro')),
  "inscricaoEstadual"  text,
  "inscricaoMunicipal" text,
  cep text, rua text, numero text, complemento text, bairro text, cidade text, estado text,
  observacoes          text,
  ativo                boolean not null default true,
  "criadoEm"           timestamptz not null default now(),
  "atualizadoEm"       timestamptz not null default now()
);
create unique index "Cliente_cpfCnpj_key" on public."Cliente"("tenantId", "cpfCnpj") where "cpfCnpj" is not null;
create index "Cliente_telefone_idx" on public."Cliente"("telefoneNormalizado");
create index "Cliente_nome_trgm" on public."Cliente" using gin (nome gin_trgm_ops);

create table public."Socio" (
  id               text primary key default gen_random_uuid()::text,
  "tenantId"       text not null default 'denos' references public."Tenant"(id),
  "clienteId"      text not null references public."Cliente"(id) on delete cascade,
  nome             text not null,
  cpf              text,
  "dataNascimento" date,
  telefone         text,
  email            text,
  participacao     numeric(5,2),                     -- % do capital
  administrador    boolean not null default false,
  "criadoEm"       timestamptz not null default now(),
  "atualizadoEm"   timestamptz not null default now()
);
create index on public."Socio"("clienteId");

-- Telefone normalizado: só dígitos; número brasileiro sem DDI ganha 55.
create or replace function public.normalizar_telefone(p text) returns text
language sql immutable as $$
  select case
    when p is null then null
    when length(regexp_replace(p, '\D', '', 'g')) in (10, 11) then '55' || regexp_replace(p, '\D', '', 'g')
    else nullif(regexp_replace(p, '\D', '', 'g'), '')
  end
$$;

create or replace function public.cliente_normaliza() returns trigger
language plpgsql as $$
begin
  new."telefoneNormalizado" := public.normalizar_telefone(new.telefone);
  new."cpfCnpj" := nullif(regexp_replace(coalesce(new."cpfCnpj", ''), '\D', '', 'g'), '');
  new."atualizadoEm" := now();
  return new;
end $$;
create trigger trg_cliente_normaliza before insert or update on public."Cliente"
  for each row execute function public.cliente_normaliza();

-- Acha o cliente pelo telefone do WhatsApp, tolerando o 9º dígito.
create or replace function public.cliente_por_telefone(p_telefone text) returns setof public."Cliente"
language sql stable as $$
  with d as (select public.normalizar_telefone(p_telefone) as t)
  select c.* from public."Cliente" c, d
  where c."telefoneNormalizado" is not null and (
        c."telefoneNormalizado" = d.t
     or (length(d.t) = 12 and c."telefoneNormalizado" = substr(d.t,1,4) || '9' || substr(d.t,5))
     or (length(d.t) = 13 and c."telefoneNormalizado" = substr(d.t,1,4) || substr(d.t,6)))
  order by c."criadoEm" limit 5
$$;

-- ---------------------------------------------------------------------------
-- WhatsApp (DDL de referência do adv3, docs/chat-whatsapp/03, sem IA nem plano)
-- ---------------------------------------------------------------------------
create table public."WhatsappSessao" (
  id                  text primary key default gen_random_uuid()::text,
  "tenantId"          text not null default 'denos' references public."Tenant"(id) on delete cascade,
  nome                text not null unique,
  apelido             text,
  numero              text,
  status              text not null default 'STOPPED'
                      check (status in ('STOPPED','STARTING','SCAN_QR_CODE','WORKING','FAILED')),
  "pushName"          text,
  "qrCodeBase64"      text,
  "ultimoErro"        text,
  "fotoPath"          text,
  "fotoPersonalizada" boolean not null default false,
  "conectadoEm"       timestamptz,
  "criadoEm"          timestamptz not null default now(),
  "atualizadoEm"      timestamptz not null default now()
);
create unique index "WhatsappSessao_numero_key" on public."WhatsappSessao"(numero) where numero is not null;
create index "WhatsappSessao_tenant_status_idx" on public."WhatsappSessao"("tenantId", status);

create table public."WhatsappChat" (
  id                     text primary key default gen_random_uuid()::text,
  "tenantId"             text not null default 'denos' references public."Tenant"(id) on delete cascade,
  "sessaoId"             text not null references public."WhatsappSessao"(id) on delete cascade,
  "chatId"               text not null,
  tipo                   text not null default 'individual' check (tipo in ('individual','group')),
  nome                   text,
  sobre                  text,
  "fotoPath"             text,
  "clienteId"            text references public."Cliente"(id) on delete set null,
  "ultimaMensagemTexto"  text,
  "ultimaMensagemEm"     timestamptz,
  "ultimaMensagemFromMe" boolean not null default false,
  "naoLidas"             integer not null default 0,
  arquivado              boolean not null default false,
  fixado                 boolean not null default false,
  "apagadoEm"            timestamptz,
  "podeEnviar"           boolean not null default true,
  "motivoBloqueio"       text check ("motivoBloqueio" in ('so_admins','removido')),
  "presenceEstado"       text check ("presenceEstado" in ('online','offline','typing','recording')),
  "presenceEm"           timestamptz,
  "ultimoVistoEm"        timestamptz,
  -- Atendimento (novo no painel Denos)
  "responsavelId"        uuid references public."Colaborador"(id) on delete set null,
  "atendimentoStatus"    text not null default 'aberto'
                         check ("atendimentoStatus" in ('aberto','em_atendimento','finalizado')),
  "atendimentoEm"        timestamptz,
  "criadoEm"             timestamptz not null default now(),
  "atualizadoEm"         timestamptz not null default now(),
  unique ("tenantId", id)
);
create unique index "WhatsappChat_tenant_sessao_chat_key" on public."WhatsappChat"("tenantId", "sessaoId", "chatId");
create index "WhatsappChat_lista_idx" on public."WhatsappChat"("tenantId", "ultimaMensagemEm" desc nulls last) where "apagadoEm" is null;
create index "WhatsappChat_lista_tipo_idx" on public."WhatsappChat"("tenantId", tipo, "ultimaMensagemEm" desc) where "apagadoEm" is null;
create index "WhatsappChat_fixadas_idx" on public."WhatsappChat"("tenantId", "ultimaMensagemEm" desc) where fixado and "apagadoEm" is null;
create index on public."WhatsappChat"("tenantId", "chatId");
create index on public."WhatsappChat"("sessaoId");
create index on public."WhatsappChat"("clienteId");
create index on public."WhatsappChat"("responsavelId");
create index on public."WhatsappChat" using gin (nome gin_trgm_ops);
create index on public."WhatsappChat" using gin ("chatId" gin_trgm_ops);

create table public."WhatsappMensagem" (
  id                   text primary key default gen_random_uuid()::text,
  "tenantId"           text not null default 'denos' references public."Tenant"(id) on delete cascade,
  "sessaoId"           text not null references public."WhatsappSessao"(id) on delete cascade,
  "chatId"             text not null,
  "wamId"              text,
  tipo                 text not null default 'text',
  texto                text,
  "mediaPath"          text,
  "mediaMime"          text,
  "mediaNomeArquivo"   text,
  "mediaTamanho"       bigint,
  latitude             double precision,
  longitude            double precision,
  payload              jsonb,
  "replyToWamId"       text,
  "replyToTexto"       text,
  "replyToThumb"       text,
  "replyToTipo"        text,
  reactions            jsonb not null default '[]'::jsonb,
  ack                  integer not null default 0 check (ack between -1 and 4),
  "fromMe"             boolean not null default false,
  origem               text check (origem in ('humano','ia','externo','sistema')),
  "pendenteEco"        boolean not null default false,
  "remetenteJid"       text,
  "remetenteNome"      text,
  -- No adv3 é "enviadoPorUserId" → User. Aqui aponta para Colaborador.
  "enviadoPorUserId"   uuid references public."Colaborador"(id) on delete set null,
  "timestamp"          timestamptz not null default now(),
  "editadoEm"          timestamptz,
  "apagadoEm"          timestamptz,
  "criadoEm"           timestamptz not null default now()
);
create unique index "WhatsappMensagem_tenant_sessao_wam_key" on public."WhatsappMensagem"("tenantId", "sessaoId", "wamId");
create index "WhatsappMensagem_conversa_idx" on public."WhatsappMensagem"("tenantId", "sessaoId", "chatId", "timestamp" desc);
create index on public."WhatsappMensagem"("tenantId", "wamId");
create index on public."WhatsappMensagem"("sessaoId");
create index "WhatsappMensagem_eco_pendente_idx" on public."WhatsappMensagem"("tenantId", "sessaoId", "chatId")
  where "wamId" is null and "fromMe" and "pendenteEco";
create index on public."WhatsappMensagem" using gin ("mediaNomeArquivo" gin_trgm_ops) where "mediaPath" is not null;
create index on public."WhatsappMensagem"("enviadoPorUserId") where "enviadoPorUserId" is not null;

create table public."WhatsappContato" (
  id             text primary key default gen_random_uuid()::text,
  "tenantId"     text not null default 'denos' references public."Tenant"(id) on delete cascade,
  "contatoId"    text not null,
  "lidId"        text,
  nome           text,
  "pushName"     text,
  numero         text,
  "fotoPath"     text,
  "criadoEm"     timestamptz not null default now(),
  "atualizadoEm" timestamptz not null default now(),
  unique ("tenantId", "contatoId")
);
create index on public."WhatsappContato"("tenantId", "lidId") where "lidId" is not null;
create index on public."WhatsappContato"("tenantId", numero);

create table public."WhatsappEventoLog" (
  id         bigserial primary key,
  "tenantId" text references public."Tenant"(id) on delete cascade,
  "sessaoId" text references public."WhatsappSessao"(id) on delete cascade,
  evento     text not null,
  payload    jsonb not null,
  "criadoEm" timestamptz not null default now()
);
create index on public."WhatsappEventoLog"("criadoEm");

create table public."WhatsappTag" (
  id         text primary key default gen_random_uuid()::text,
  "tenantId" text not null default 'denos' references public."Tenant"(id) on delete cascade,
  label      text not null,
  cor        text not null default 'primary' check (cor in ('primary','success','warning','destructive','muted')),
  "criadoEm" timestamptz not null default now(),
  unique ("tenantId", id)
);
create unique index on public."WhatsappTag"("tenantId", lower(label));

create table public."WhatsappChatTag" (
  "tenantId" text not null default 'denos' references public."Tenant"(id) on delete cascade,
  "chatId"   text not null,
  "tagId"    text not null,
  "criadoEm" timestamptz not null default now(),
  primary key ("chatId", "tagId"),
  foreign key ("tenantId", "chatId") references public."WhatsappChat"("tenantId", id) on delete cascade,
  foreign key ("tenantId", "tagId")  references public."WhatsappTag"("tenantId", id)  on delete cascade
);
create index on public."WhatsappChatTag"("tenantId", "tagId");

-- Histórico de transferência de atendimento.
create table public."AtendimentoTransferencia" (
  id          text primary key default gen_random_uuid()::text,
  "tenantId"  text not null default 'denos' references public."Tenant"(id),
  "chatId"    text not null references public."WhatsappChat"(id) on delete cascade,
  "deId"      uuid references public."Colaborador"(id) on delete set null,
  "paraId"    uuid references public."Colaborador"(id) on delete set null,
  "porId"     uuid references public."Colaborador"(id) on delete set null,
  motivo      text,
  "criadoEm"  timestamptz not null default now()
);
create index on public."AtendimentoTransferencia"("chatId", "criadoEm" desc);

-- Transferir = trocar o responsável e registrar, numa transação só.
create or replace function public.transferir_atendimento(
  p_chat text, p_para uuid, p_por uuid, p_motivo text default null)
returns void language plpgsql as $$
declare v_de uuid;
begin
  select "responsavelId" into v_de from public."WhatsappChat" where id = p_chat for update;
  if not found then raise exception 'conversa não encontrada'; end if;
  update public."WhatsappChat"
     set "responsavelId" = p_para,
         "atendimentoStatus" = case when p_para is null then 'aberto' else 'em_atendimento' end,
         "atendimentoEm" = now(), "atualizadoEm" = now()
   where id = p_chat;
  insert into public."AtendimentoTransferencia" ("chatId", "deId", "paraId", "porId", motivo)
  values (p_chat, v_de, p_para, p_por, nullif(trim(p_motivo), ''));
end $$;

create or replace function public.consumir_eco_fromme(
  p_tenant text, p_sessao text, p_chat text, p_wamid text, p_ack integer, p_texto text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  update public."WhatsappMensagem" m
     set "wamId" = p_wamid, ack = greatest(m.ack, coalesce(p_ack, 1)), "pendenteEco" = false
   where m.id = (
     select id from public."WhatsappMensagem"
      where "tenantId" = p_tenant and "sessaoId" = p_sessao and "chatId" = p_chat
        and "fromMe" and "wamId" is null and "pendenteEco"
        and p_texto is not null and texto = p_texto
        and "criadoEm" > now() - interval '2 minutes'
      order by "criadoEm" asc for update skip locked limit 1)
     and "pendenteEco"
  returning m.id into v_id;
  return v_id is not null;
end $$;
revoke all on function public.consumir_eco_fromme(text,text,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.consumir_eco_fromme(text,text,text,text,integer,text) to service_role;

create table public."RateLimit" (
  bucket       text primary key,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);
alter table public."RateLimit" enable row level security;

create or replace function public.rate_limit_hit(p_key text, p_max integer, p_window_secs integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  insert into public."RateLimit" (bucket, window_start, count) values (p_key, now(), 1)
  on conflict (bucket) do update set
    count = case when public."RateLimit".window_start < now() - make_interval(secs => p_window_secs)
                 then 1 else public."RateLimit".count + 1 end,
    window_start = case when public."RateLimit".window_start < now() - make_interval(secs => p_window_secs)
                        then now() else public."RateLimit".window_start end
  returning count into v_count;
  return v_count <= p_max;
end $$;
revoke all on function public.rate_limit_hit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text,integer,integer) to service_role;

-- Sem plano nem cota no painel Denos: a cota sempre tem espaço.
create or replace function public.tenant_quota_has_room(tid text, additional_bytes bigint)
returns boolean language sql stable as $$ select true $$;

-- ---------------------------------------------------------------------------
-- Solicitações (botão na conversa)
-- ---------------------------------------------------------------------------
create table public."SolicitacaoTipo" (
  id         text primary key default gen_random_uuid()::text,
  "tenantId" text not null default 'denos' references public."Tenant"(id),
  nome       text not null,
  descricao  text,
  ordem      integer not null default 0,
  ativo      boolean not null default true,
  "criadoEm" timestamptz not null default now()
);
create unique index on public."SolicitacaoTipo"("tenantId", lower(nome));

insert into public."SolicitacaoTipo" (nome, ordem) values
  ('Emissão de nota fiscal', 10), ('Segunda via de guia (DAS/DARF)', 20),
  ('Certidão negativa', 30), ('Folha de pagamento / pró-labore', 40),
  ('Admissão de funcionário', 50), ('Rescisão de funcionário', 60),
  ('Alteração contratual', 70), ('Declaração de IR', 80),
  ('Parcelamento de débitos', 90), ('Outros', 1000);

create table public."Solicitacao" (
  id              text primary key default gen_random_uuid()::text,
  "tenantId"      text not null default 'denos' references public."Tenant"(id),
  "tipoId"        text not null references public."SolicitacaoTipo"(id),
  "clienteId"     text references public."Cliente"(id) on delete set null,
  "chatId"        text references public."WhatsappChat"(id) on delete set null,
  "mensagemId"    text references public."WhatsappMensagem"(id) on delete set null,
  descricao       text,
  status          text not null default 'aberta'
                  check (status in ('aberta','em_andamento','concluida','cancelada')),
  "criadoPorId"   uuid references public."Colaborador"(id) on delete set null,
  "responsavelId" uuid references public."Colaborador"(id) on delete set null,
  prazo           date,
  "concluidaEm"   timestamptz,
  "criadoEm"      timestamptz not null default now(),
  "atualizadoEm"  timestamptz not null default now()
);
create index on public."Solicitacao"("tipoId", "criadoEm");
create index on public."Solicitacao"("clienteId");
create index on public."Solicitacao"("chatId");
create index on public."Solicitacao"(status, "criadoEm" desc);

-- Relatório: tipos mais pedidos no período.
create or replace function public.relatorio_solicitacoes(p_de timestamptz, p_ate timestamptz)
returns table ("tipoId" text, nome text, total bigint, abertas bigint, concluidas bigint)
language sql stable as $$
  select t.id, t.nome, count(s.id),
         count(s.id) filter (where s.status in ('aberta','em_andamento')),
         count(s.id) filter (where s.status = 'concluida')
  from public."SolicitacaoTipo" t
  left join public."Solicitacao" s on s."tipoId" = t.id
       and s."criadoEm" >= p_de and s."criadoEm" < p_ate
  group by t.id, t.nome
  order by count(s.id) desc, t.nome
$$;

-- ---------------------------------------------------------------------------
-- Certificado digital
-- ---------------------------------------------------------------------------
create table public."CertificadoDigital" (
  id             text primary key default gen_random_uuid()::text,
  "tenantId"     text not null default 'denos' references public."Tenant"(id),
  "clienteId"    text not null references public."Cliente"(id) on delete cascade,
  tipo           text not null default 'e-CNPJ A1'
                 check (tipo in ('e-CNPJ A1','e-CNPJ A3','e-CPF A1','e-CPF A3','NF-e','Outro')),
  titular        text,
  documento      text,                                -- CPF/CNPJ do titular
  emissora       text,                                -- AC: Serasa, Certisign, Valid...
  "emitidoEm"    date,
  "validoAte"    date not null,
  -- Para quem avisar. Vazio = telefone do cliente.
  "telefoneAviso" text,
  "avisarWhatsapp" boolean not null default true,
  observacoes    text,
  "renovadoPorId" text references public."CertificadoDigital"(id) on delete set null,
  "criadoEm"     timestamptz not null default now(),
  "atualizadoEm" timestamptz not null default now()
);
create index on public."CertificadoDigital"("validoAte");
create index on public."CertificadoDigital"("clienteId");

-- Um aviso por certificado por marco (30/15/7/1/0 dias). A unique impede
-- mandar duas vezes o mesmo marco mesmo se o cron rodar de novo.
create table public."CertificadoAviso" (
  id               text primary key default gen_random_uuid()::text,
  "tenantId"       text not null default 'denos' references public."Tenant"(id),
  "certificadoId"  text not null references public."CertificadoDigital"(id) on delete cascade,
  marco            integer not null,
  telefone         text,
  status           text not null default 'enviado' check (status in ('enviado','falhou','sem_telefone','sem_conexao')),
  erro             text,
  "mensagemId"     text references public."WhatsappMensagem"(id) on delete set null,
  "criadoEm"       timestamptz not null default now(),
  unique ("certificadoId", marco)
);

-- ---------------------------------------------------------------------------
-- Consulta de pendências fiscais (Serpro Integra Contador)
-- ---------------------------------------------------------------------------
create table public."ConsultaFiscal" (
  id           text primary key default gen_random_uuid()::text,
  "tenantId"   text not null default 'denos' references public."Tenant"(id),
  "clienteId"  text not null references public."Cliente"(id) on delete cascade,
  servico      text not null,                       -- ex.: SITFIS, PGDASD, DCTFWEB
  status       text not null default 'pendente' check (status in ('pendente','ok','com_pendencia','erro')),
  resumo       text,
  resultado    jsonb,
  erro         text,
  "porId"      uuid references public."Colaborador"(id) on delete set null,
  "criadoEm"   timestamptz not null default now()
);
create index on public."ConsultaFiscal"("clienteId", "criadoEm" desc);

-- ---------------------------------------------------------------------------
-- Configuração chave/valor (sessão padrão de avisos, modelos de mensagem, Serpro)
-- Segredos (chaves do Serpro, certificado) NÃO moram aqui: ficam no env das funções.
-- ---------------------------------------------------------------------------
create table public."Config" (
  chave          text primary key,
  valor          jsonb not null,
  "atualizadoEm" timestamptz not null default now()
);
insert into public."Config" (chave, valor) values
  ('certificado.marcos', '[30, 15, 7, 1, 0]'),
  ('certificado.sessaoId', 'null'),
  ('certificado.modelo', to_jsonb('Olá, {cliente}! O certificado digital {tipo} vence em {data} ({dias}). Fale com a gente para renovar e não ficar sem emitir notas e guias. Contabilidade Denos'::text)),
  ('serpro.ambiente', to_jsonb('producao'::text));

-- ---------------------------------------------------------------------------
-- Aniversários: empresas (abertura), pessoas e sócios, numa view só.
-- ---------------------------------------------------------------------------
create or replace view public."Aniversario" with (security_invoker = true) as
  select 'empresa'::text as origem, c.id as "clienteId", null::text as "socioId",
         coalesce(c."nomeFantasia", c.nome) as nome, c.nome as "clienteNome",
         c."dataAbertura" as data, c.telefone
    from public."Cliente" c where c.tipo = 'PJ' and c."dataAbertura" is not null and c.ativo
  union all
  select 'pessoa', c.id, null, c.nome, c.nome, c."dataNascimento", c.telefone
    from public."Cliente" c where c.tipo = 'PF' and c."dataNascimento" is not null and c.ativo
  union all
  select 'socio', s."clienteId", s.id, s.nome, c.nome, s."dataNascimento", coalesce(s.telefone, c.telefone)
    from public."Socio" s join public."Cliente" c on c.id = s."clienteId"
   where s."dataNascimento" is not null and c.ativo;

-- ---------------------------------------------------------------------------
-- atualizadoEm automático
-- ---------------------------------------------------------------------------
create or replace function public.touch_atualizado_em() returns trigger
language plpgsql as $$ begin new."atualizadoEm" := now(); return new; end $$;
create trigger trg_touch before update on public."Colaborador" for each row execute function public.touch_atualizado_em();
create trigger trg_touch before update on public."Socio" for each row execute function public.touch_atualizado_em();
create trigger trg_touch before update on public."Solicitacao" for each row execute function public.touch_atualizado_em();
create trigger trg_touch before update on public."CertificadoDigital" for each row execute function public.touch_atualizado_em();

-- ---------------------------------------------------------------------------
-- RLS — ver o aviso no topo: sem login, anon lê e escreve o que a tela usa.
-- Mensagem, contato, sessão e log: só leitura pela tela (escrita é do backend).
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['Tenant','Colaborador','Cliente','Socio','WhatsappSessao','WhatsappChat',
    'WhatsappMensagem','WhatsappContato','WhatsappEventoLog','WhatsappTag','WhatsappChatTag',
    'AtendimentoTransferencia','SolicitacaoTipo','Solicitacao','CertificadoDigital','CertificadoAviso',
    'ConsultaFiscal','Config']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy painel_select on public.%I for select to anon, authenticated using (true)', t);
  end loop;
  foreach t in array array['Colaborador','Cliente','Socio','WhatsappTag','WhatsappChatTag',
    'SolicitacaoTipo','Solicitacao','CertificadoDigital','Config']
  loop
    execute format('create policy painel_write on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Conversa: a tela só muda fixar/arquivar/vincular/atendimento.
create policy painel_update on public."WhatsappChat" for update to anon, authenticated using (true) with check (true);
revoke update on public."WhatsappChat" from anon, authenticated;
grant update (fixado, arquivado, "clienteId", "responsavelId", "atendimentoStatus", "atendimentoEm", "atualizadoEm")
  on public."WhatsappChat" to anon, authenticated;

grant execute on function public.transferir_atendimento(text, uuid, uuid, text) to anon, authenticated;
grant select on public."Aniversario" to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bucket de mídia (privado). Primeira pasta = 'denos'.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp-media', 'whatsapp-media', false, 67108864)
on conflict (id) do nothing;

create policy whatsapp_media_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'whatsapp-media');
create policy whatsapp_media_insert_uploads on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'whatsapp-media' and (storage.foldername(name))[2] = 'uploads');

-- ---------------------------------------------------------------------------
-- Tempo real
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public."WhatsappSessao";
alter publication supabase_realtime add table public."WhatsappChat";
alter publication supabase_realtime add table public."WhatsappMensagem";
alter publication supabase_realtime add table public."Solicitacao";
