-- ===========================================================================
-- 006: fecha a etapa 1.
--   1. Dois tipos de chamado novos no topo (Recálculo de guia, Declaração de
--      faturamento). Os existentes ficam.
--   2. Equipe só para administradores: equipe.ver/equipe.gerenciar saem dos
--      cargos que não são de sistema. A leitura de Colaborador continua
--      liberada a todo colaborador ativo (eu_colaborador_ativo, migration
--      005), então chat e chamados seguem listando os colegas.
--   3. Serpro: permissão serpro.agendar, AgendamentoSerpro, colunas de origem
--      e custo em ConsultaFiscal, view da última consulta por cliente e
--      serviço, e o job do pg_cron.
-- Tudo idempotente: reaplicar não duplica nada.
-- ===========================================================================

-- 1. Tipos de chamado ----------------------------------------------------------
insert into public."SolicitacaoTipo" (nome, ordem) values
  ('Recálculo de guia', 1), ('Declaração de faturamento', 2)
on conflict ("tenantId", lower(nome)) do update set ordem = excluded.ordem, ativo = true;

-- 2. Equipe fora dos cargos comuns ---------------------------------------------
update public."Cargo"
   set permissoes = array(select p from unnest(permissoes) p where p not in ('equipe.ver','equipe.gerenciar'))
 where not sistema and permissoes && array['equipe.ver','equipe.gerenciar'];

-- 3. Serpro ----------------------------------------------------------------------
insert into public."Permissao" (chave, modulo, rotulo, descricao, ordem) values
  ('serpro.agendar', 'Pendências fiscais', 'Agendar consultas',
   'Liga, desliga e muda os agendamentos automáticos do Serpro (cada consulta é cobrada).', 52)
on conflict (chave) do update set rotulo = excluded.rotulo, descricao = excluded.descricao, ordem = excluded.ordem;

create table if not exists public."AgendamentoSerpro" (
  id                text primary key default gen_random_uuid()::text,
  "tenantId"        text not null default 'denos' references public."Tenant"(id),
  servico           text not null check (servico in ('SITFIS','CAIXAPOSTAL','PARCELAMENTOS','PROCURACAO')),
  "diaMes"          integer not null default 5 check ("diaMes" between 1 and 28),
  ativo             boolean not null default false,
  -- true = todos os clientes ativos com CPF/CNPJ; false = só "clienteIds".
  "todosAtivos"     boolean not null default true,
  "clienteIds"      text[] not null default '{}',
  -- Ciclo: começa no dia escolhido; o cron processa em pedaços e anda pelo cursor.
  "cicloEm"         date,
  "cicloConcluido"  boolean not null default true,
  cursor            text,
  "cicloConsultas"  integer not null default 0,
  "cicloCusto"      numeric(10,2) not null default 0,
  "ultimaExecucao"  timestamptz,
  "ultimoResultado" text,
  "ultimoErro"      text,
  "alteradoPorId"   uuid references public."Colaborador"(id) on delete set null,
  "criadoEm"        timestamptz not null default now(),
  "atualizadoEm"    timestamptz not null default now(),
  unique ("tenantId", servico)
);
drop trigger if exists trg_touch on public."AgendamentoSerpro";
create trigger trg_touch before update on public."AgendamentoSerpro" for each row execute function public.touch_atualizado_em();
alter table public."AgendamentoSerpro" enable row level security;
drop policy if exists painel_select on public."AgendamentoSerpro";
create policy painel_select on public."AgendamentoSerpro" for select to authenticated
  using ((select public.tem_alguma(array['serpro.consultar','serpro.agendar'])));
drop policy if exists painel_write on public."AgendamentoSerpro";
create policy painel_write on public."AgendamentoSerpro" for all to authenticated
  using ((select public.tem_permissao('serpro.agendar'))) with check ((select public.tem_permissao('serpro.agendar')));
grant select, insert, update, delete on public."AgendamentoSerpro" to authenticated;

insert into public."AgendamentoSerpro" (servico, "diaMes") values
  ('SITFIS', 5), ('CAIXAPOSTAL', 5), ('PARCELAMENTOS', 5), ('PROCURACAO', 5)
on conflict ("tenantId", servico) do nothing;

alter table public."ConsultaFiscal" add column if not exists origem text not null default 'manual';
alter table public."ConsultaFiscal" add column if not exists "agendamentoId" text references public."AgendamentoSerpro"(id) on delete set null;
alter table public."ConsultaFiscal" add column if not exists "custoEstimado" numeric(10,2);
do $$ begin
  alter table public."ConsultaFiscal" add constraint "ConsultaFiscal_origem_check" check (origem in ('manual','agendamento'));
exception when duplicate_object then null; end $$;
create index if not exists "ConsultaFiscal_criadoEm_idx" on public."ConsultaFiscal"("criadoEm" desc);
create index if not exists "ConsultaFiscal_cli_serv_idx" on public."ConsultaFiscal"("clienteId", servico, "criadoEm" desc);

-- Última consulta concluída (não pendente) de cada cliente em cada serviço.
create or replace view public."ConsultaFiscalUltima" with (security_invoker = true) as
  select distinct on ("clienteId", servico)
         id, "clienteId", servico, status, resumo, resultado, erro, origem, "custoEstimado", "criadoEm"
    from public."ConsultaFiscal"
   where status <> 'pendente'
   order by "clienteId", servico, "criadoEm" desc;
grant select on public."ConsultaFiscalUltima" to authenticated;

-- Custo por mês (fuso de São Paulo), para a aba Custos.
create or replace function public.serpro_custos_mensais(p_meses integer default 12)
returns table (mes text, consultas bigint, agendadas bigint, custo numeric)
language sql stable security invoker set search_path = public as $$
  select to_char(date_trunc('month', "criadoEm" at time zone 'America/Sao_Paulo'), 'YYYY-MM'),
         count(*), count(*) filter (where origem = 'agendamento'), coalesce(sum("custoEstimado"), 0)
    from public."ConsultaFiscal"
   where "criadoEm" >= date_trunc('month', now() at time zone 'America/Sao_Paulo') - make_interval(months => greatest(p_meses, 1) - 1)
   group by 1 order by 1 desc
$$;
grant execute on function public.serpro_custos_mensais(integer) to authenticated;

-- Pedaços do ciclo: a cada 10 min das 08h às 19h50 de São Paulo (UTC-3). Cada
-- chamada processa ~100 s de clientes e sai; sem agendamento devido, só lê a
-- tabela e sai. Um único disparo diário não caberia no limite de 150 s do runtime.
select cron.schedule('serpro-agendado', '*/10 11-22 * * *', $$select public.cron_chamar('serpro-agendado')$$);
