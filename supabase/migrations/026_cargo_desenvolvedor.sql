-- 026 — Cargos Desenvolvedor e Administrador; área técnica só do desenvolvedor
--
-- Decisão do dono (23/10/2026): quem mantém o painel (desenvolvedor) vê tudo; a
-- dona do escritório (Administrador) vê tudo do dia a dia, mas não a parte
-- técnica; os funcionários, conforme o cargo de cada um.
--
--  1. Permissão nova "sistema.tecnico" (Área técnica): Configurações >
--     Integrações e Sistema (versão, backup, Google Drive, log de erros,
--     ferramentas), a chave "Entrar só com o e-mail" e as RPCs de saúde, erros e
--     backup. Só o cargo de sistema a tem (implícita): o cargo_guard recusa
--     colocá-la em qualquer outro cargo pela tela.
--  2. O cargo de sistema (todas as permissões, intocável) passa a se chamar
--     "Desenvolvedor".
--  3. Cargo comum "Administrador": todas as permissões menos a área técnica.
--     Quem é dele gerencia equipe e cargos, mas não mexe em quem é
--     Desenvolvedor (function equipe) nem se dá a área técnica (cargo_guard).
--
-- Quem vai para cada cargo é feito à parte (SQL avulso), não aqui.
-- Não destrutiva e idempotente.

-- ---------------------------------------------------------------------------
-- 1. Permissão da área técnica
-- ---------------------------------------------------------------------------
insert into public."Permissao" (chave, modulo, rotulo, descricao, ordem) values
  ('sistema.tecnico', 'Configurações', 'Área técnica',
   'Integrações, sistema, backup, log de erros e entrada só com o e-mail. Só o cargo Desenvolvedor.', 85)
on conflict (chave) do nothing;
update public."Permissao" set descricao = 'Geral, módulos, marca, importar e exportar.'
 where chave = 'configuracoes.gerenciar';

-- ---------------------------------------------------------------------------
-- 2 e 3. Desenvolvedor (sistema) e Administrador (comum)
-- ---------------------------------------------------------------------------
update public."Cargo"
   set nome = 'Desenvolvedor',
       descricao = 'Quem mantém o painel: todas as permissões, inclusive a área técnica. Não se edita nem se apaga.'
 where sistema and nome <> 'Desenvolvedor';

insert into public."Cargo" (nome, descricao, permissoes, sistema)
select 'Administrador',
       'Dona do escritório: tudo do dia a dia (equipe, cargos, configurações, todos os módulos), sem a área técnica.',
       array(select chave from public."Permissao" where chave <> 'sistema.tecnico' order by ordem, chave),
       false
 where not exists (select 1 from public."Cargo" where "tenantId" = 'denos' and lower(nome) = 'administrador');

-- ---------------------------------------------------------------------------
-- cargo_guard (021) + área técnica só no cargo de sistema
-- ---------------------------------------------------------------------------
create or replace function public.cargo_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_invalidas text[];
  -- Papel de quem pediu (JWT). Migração e SQL direto não têm JWT: ''.
  v_tela boolean := coalesce(auth.role(), '') in ('authenticated', 'anon');
begin
  if v_tela and tg_op in ('UPDATE','DELETE') and old.sistema then
    raise exception 'O cargo Desenvolvedor não pode ser alterado nem apagado.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public."Colaborador" where "cargoId" = old.id) then
      raise exception 'Há pessoas neste cargo. Mova-as para outro cargo antes de apagar.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if v_tela and new.sistema then
    raise exception 'Cargo de sistema não pode ser criado nem marcado pela tela.' using errcode = 'P0001';
  end if;
  if v_tela and 'sistema.tecnico' = any(new.permissoes) then
    raise exception 'A área técnica é só do cargo Desenvolvedor.' using errcode = 'P0001';
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

-- ---------------------------------------------------------------------------
-- RPCs técnicas exigem a área técnica
-- ---------------------------------------------------------------------------
create or replace function public.painel_saude()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.painel_exigir('sistema.tecnico');
  return public.painel_saude_dados();
end $$;

create or replace function public.painel_erros(p_limite integer default 50)
returns table (id bigint, origem text, nivel text, mensagem text, stack text,
               contexto jsonb, rota text, status integer, "duracaoMs" integer, "criadoEm" timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.painel_exigir('sistema.tecnico');
  return query select * from public.painel_erros_dados(p_limite);
end $$;

create or replace function public.painel_backup_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.painel_exigir('sistema.tecnico');
  return public.painel_backup_status_dados();
end $$;

drop policy if exists painel_select on public."WhatsappEventoLog";
create policy painel_select on public."WhatsappEventoLog" for select to authenticated
  using ((select public.tem_permissao('sistema.tecnico')));

-- Módulos (022): a chave "Entrar só com o e-mail" é segurança do login, não
-- do dia a dia: só a área técnica liga ou desliga.
create or replace function public.config_modulo_definir(p_chave text, p_ligado boolean)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_valor jsonb;
begin
  if p_chave is null or p_chave !~ '^[A-Za-z][A-Za-z0-9]{1,62}$' then
    raise exception 'Módulo inválido.' using errcode = '22023';
  end if;
  if p_ligado is null then
    raise exception 'Informe se o módulo fica ligado ou desligado.' using errcode = '22023';
  end if;
  if p_chave = 'loginSemVerificacao' and not public.tem_permissao('sistema.tecnico') then
    raise exception 'Só o cargo Desenvolvedor muda a forma de entrar no painel.' using errcode = '42501';
  end if;
  insert into public."Config" (chave, valor, "atualizadoEm")
  values ('modulos', jsonb_build_object(p_chave, p_ligado), now())
  on conflict (chave) do update
    set valor = (case when jsonb_typeof(public."Config".valor) = 'object' then public."Config".valor else '{}'::jsonb end)
                || excluded.valor,
        "atualizadoEm" = now()
  returning valor into v_valor;
  return v_valor;
end $$;
