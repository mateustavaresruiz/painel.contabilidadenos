-- 022 — Pendentes médios da revisão de 20/10/2026
--
--  1. Configurações > Módulos: RPC config_modulo_definir muda UMA chave do
--     objeto 'modulos' no próprio banco (jsonb ||). A tela gravava o objeto
--     inteiro: uma aba aberta há tempo desfazia o que outra pessoa tinha mudado
--     nas outras chaves. SECURITY INVOKER: a RLS de Config continua valendo
--     (configuracoes.gerenciar).
--  2. Config.valor aceita null vindo da tela: vira o jsonb 'null' (a coluna é
--     NOT NULL). Usado pelo modelo do aviso de certificado igual ao padrão e
--     pelo "nenhum número" dos avisos.
--  3. Auditoria: índice trigram em AuditoriaEvento."atorNome" (a busca da tela
--     faz ilike '%termo%' em resumo OU atorNome; só o resumo tinha índice).
--
-- Não destrutiva: só cria função, gatilho e índice. Nenhuma linha é alterada.

-- ---------------------------------------------------------------------------
-- 1. Módulos: muda só a chave alterada
-- ---------------------------------------------------------------------------
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
  insert into public."Config" (chave, valor, "atualizadoEm")
  values ('modulos', jsonb_build_object(p_chave, p_ligado), now())
  on conflict (chave) do update
    set valor = (case when jsonb_typeof(public."Config".valor) = 'object' then public."Config".valor else '{}'::jsonb end)
                || excluded.valor,
        "atualizadoEm" = now()
  returning valor into v_valor;
  return v_valor;
end $$;
revoke all on function public.config_modulo_definir(text, boolean) from public, anon;
grant execute on function public.config_modulo_definir(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Config.valor: null da tela vira jsonb 'null'
-- ---------------------------------------------------------------------------
create or replace function public.config_valor_nulo() returns trigger
language plpgsql set search_path = public as $$
begin
  new.valor := coalesce(new.valor, 'null'::jsonb);
  return new;
end $$;
drop trigger if exists trg_config_valor_nulo on public."Config";
create trigger trg_config_valor_nulo before insert or update on public."Config"
  for each row execute function public.config_valor_nulo();
revoke all on function public.config_valor_nulo() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Auditoria: busca por quem fez
-- ---------------------------------------------------------------------------
create index if not exists "AuditoriaEvento_atorNome_trgm"
  on public."AuditoriaEvento" using gin ("atorNome" public.gin_trgm_ops);
