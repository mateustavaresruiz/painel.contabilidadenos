-- 010 · Portal do cliente (link público com senha, enviado pelo escritório)
--
-- Idempotente e não destrutiva: só cria tabela, colunas, índices, funções e uma
-- permissão. Nenhuma linha existente é apagada ou alterada, exceto o cargo
-- Contador, que ganha a permissão nova (array_append, uma vez só).
--
--  1. "ClientePortalToken": um link por cliente. Guarda só o sha256 do token e o
--     hash PBKDF2 da senha (nunca o claro). O navegador NÃO lê nem escreve a
--     tabela: toda a gestão passa pela Edge Function `portal`, que confere o
--     login do colaborador e a permissão `portal.gerenciar`.
--  2. "Cliente"."portalMostrarSituacaoFiscal": liga, por cliente, o resumo da
--     situação fiscal (Serpro) no portal. Padrão desligado.
--  3. "Solicitacao".origem: de onde nasceu o chamado ('painel', 'whatsapp',
--     'portal'). O formulário do portal grava 'portal' (a lista mostra o selo).
--  4. Permissão `portal.gerenciar` (Administrador já tem todas; Contador ganha).
--  5. Funções internas (só service_role) para contar acesso e falha de senha de
--     forma atômica, com bloqueio temporário do link depois de muitos erros.
--
-- Mensagens cliente <-> escritório (MensagemPortal do adv3) NÃO foram portadas:
-- no adv3 a tabela existe mas está despublicada (sem rota, sem tela de resposta
-- no escritório). O cliente fala com a equipe pelo formulário "Solicitar algo"
-- (vira chamado) e pelo botão de WhatsApp.

-- ---------------------------------------------------------------------------
-- 1. Tabela do link
-- ---------------------------------------------------------------------------
create table if not exists public."ClientePortalToken" (
  id                text primary key default gen_random_uuid()::text,
  "tenantId"        text not null default 'denos' references public."Tenant"(id),
  "clienteId"       text not null references public."Cliente"(id) on delete cascade,
  "tokenHash"       text not null,                       -- sha256 hex do token (24 bytes aleatórios)
  "senhaHash"       text not null,                       -- pbkdf2$iter$salt$hash
  "criadoPorId"     uuid references public."Colaborador"(id) on delete set null,
  "criadoEm"        timestamptz not null default now(),
  "expiresAt"       timestamptz,                         -- nulo = sem expiração
  "revogadoEm"      timestamptz,
  "ultimoAcessoEm"  timestamptz,
  acessos           integer not null default 0,
  falhas            integer not null default 0,          -- senhas erradas seguidas
  "bloqueadoAte"    timestamptz                          -- trava temporária por excesso de erros
);

create unique index if not exists "ClientePortalToken_tokenHash_key"
  on public."ClientePortalToken"("tokenHash");
create index if not exists "ClientePortalToken_clienteId_idx"
  on public."ClientePortalToken"("clienteId", "criadoEm" desc);
-- No máximo um link ativo por cliente (gerar um novo revoga o anterior).
create unique index if not exists "ClientePortalToken_ativo_key"
  on public."ClientePortalToken"("clienteId") where "revogadoEm" is null;

alter table public."ClientePortalToken" enable row level security;
-- Sem política nenhuma: nem leitura. Só a Edge Function (service_role) enxerga.
revoke all on public."ClientePortalToken" from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Situação fiscal no portal (por cliente)
-- ---------------------------------------------------------------------------
alter table public."Cliente"
  add column if not exists "portalMostrarSituacaoFiscal" boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3. Origem do chamado
-- ---------------------------------------------------------------------------
alter table public."Solicitacao" add column if not exists origem text not null default 'painel';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'Solicitacao_origem_check') then
    alter table public."Solicitacao"
      add constraint "Solicitacao_origem_check" check (origem in ('painel', 'whatsapp', 'portal'));
  end if;
end $$;
create index if not exists "Solicitacao_portal_idx"
  on public."Solicitacao"("criadoEm" desc) where origem = 'portal';

-- ---------------------------------------------------------------------------
-- 4. Permissão
-- ---------------------------------------------------------------------------
insert into public."Permissao" (chave, modulo, rotulo, descricao, ordem) values
  ('portal.gerenciar', 'Clientes', 'Gerenciar o portal do cliente',
   'Gera, revoga e troca a senha do link do portal, vê os acessos e liga a situação fiscal no portal.', 34)
on conflict (chave) do nothing;

update public."Cargo"
   set permissoes = array_append(permissoes, 'portal.gerenciar')
 where nome = 'Contador' and not sistema
   and not ('portal.gerenciar' = any(permissoes));

-- ---------------------------------------------------------------------------
-- 5. Contadores atômicos (service_role)
-- ---------------------------------------------------------------------------

/** Acesso bem-sucedido: conta, marca a hora e zera os erros seguidos. */
create or replace function public.portal_registrar_acesso(p_id text)
returns integer language sql security definer set search_path = public as $$
  update public."ClientePortalToken"
     set acessos = acessos + 1, "ultimoAcessoEm" = now(), falhas = 0, "bloqueadoAte" = null
   where id = p_id
  returning acessos
$$;

/**
 * Senha errada: soma um erro; no 8º seguido trava o link por 15 minutos
 * (e zera a contagem). Devolve até quando está travado, ou nulo.
 */
create or replace function public.portal_registrar_falha(p_id text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_falhas integer;
  v_ate timestamptz;
begin
  update public."ClientePortalToken"
     set falhas = falhas + 1
   where id = p_id
  returning falhas into v_falhas;
  if v_falhas is not null and v_falhas >= 8 then
    update public."ClientePortalToken"
       set falhas = 0, "bloqueadoAte" = now() + interval '15 minutes'
     where id = p_id
    returning "bloqueadoAte" into v_ate;
  end if;
  return v_ate;
end $$;

revoke all on function public.portal_registrar_acesso(text) from public, anon, authenticated;
grant execute on function public.portal_registrar_acesso(text) to service_role;
revoke all on function public.portal_registrar_falha(text) from public, anon, authenticated;
grant execute on function public.portal_registrar_falha(text) to service_role;
