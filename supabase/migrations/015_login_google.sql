-- 015: "Entrar com Google" (docs/LOGIN.md > Login com Google).
--
-- Só acrescenta: uma RPC para a página /auth/callback registrar
-- "entrou no painel (Google)" depois de trocar o ?code= pela sessão.
-- A registrar_login (link/código) não muda.
--
-- O navegador não decide o método: a função só grava se o JWT da sessão
-- diz que ela nasceu de um login OAuth (amr.method = 'oauth') e se o usuário
-- tem mesmo uma identidade Google no Auth. Um por pessoa a cada 2 minutos,
-- como a registrar_login.

create or replace function public.registrar_login_google()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := public.eu_colaborador_id();
begin
  if v_eu is null then return; end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) e
     where e ->> 'method' = 'oauth') then
    return;
  end if;
  if not exists (select 1 from auth.identities i where i.user_id = auth.uid() and i.provider = 'google') then
    return;
  end if;
  if exists (select 1 from public."AuditoriaEvento"
              where modulo = 'acesso' and "atorId" = v_eu and acao = 'login'
                and "criadoEm" > now() - interval '2 minutes') then
    return;
  end if;
  perform public.auditoria_registrar('acesso', 'colaborador', v_eu::text, 'login', 'entrou no painel (Google)',
    jsonb_build_object('info', public.auditoria_info('Como', 'Conta Google')),
    'painel', null, null, null, v_eu);
end $$;

revoke all on function public.registrar_login_google() from public, anon;
grant execute on function public.registrar_login_google() to authenticated;
