-- 017 · "Entrou no painel" registrado pelo servidor (link e código por e-mail)
--
-- Idempotente e não destrutiva: cria/substitui funções e um gatilho. Nenhuma
-- linha existente é alterada ou apagada.
--
-- Antes: quem gravava a entrada por link/código era o navegador, chamando a RPC
-- registrar_login depois de trocar o token pela sessão. Se a tela falhasse (aba
-- fechada, rede) a entrada sumia da auditoria.
--
-- Agora: o próprio Auth (GoTrue) avisa. Toda sessão nova ganha uma linha em
-- auth.mfa_amr_claims com o método (otp, oauth, password...); o gatilho abaixo
-- acha o Colaborador do usuário e grava "entrou no painel" com o IP da sessão.
--
--   * otp      → link de acesso OU código do e-mail. O GoTrue grava "otp" para
--                os dois (o link usa token_hash, o código usa os 6 números, e o
--                servidor não guarda qual foi). O gatilho grava "Link ou código
--                por e-mail" e a tela, logo depois, só REFINA para "Link de
--                acesso" ou "Código por e-mail" (registrar_login, abaixo).
--   * oauth    → ignorado aqui: o Google tem o seu (registrar_login_google, 015).
--   * password → "Senha" (o painel não usa; aparece só se alguém usar a API).
--   * demais   → o nome do método.
--
-- Sem duplicar: se já existe "entrou no painel" da mesma pessoa nos últimos 2
-- minutos, o gatilho não grava. É assim que a entrada só com o e-mail (function
-- `entrar`, que grava "Só com o e-mail (sem verificação)" ANTES de a tela trocar
-- o token) não aparece duas vezes.
--
-- O gatilho roda dentro da transação do login: qualquer erro é engolido (warning)
-- para nunca impedir ninguém de entrar.

-- ---------------------------------------------------------------------------
-- 1. Gatilho em auth.mfa_amr_claims
-- ---------------------------------------------------------------------------
create or replace function public.auditoria_login_sessao()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_ip inet;
  v_colab uuid;
  v_como text;
  v_info jsonb;
begin
  if new.authentication_method = 'oauth' then return null; end if;

  select s.user_id, s.ip into v_user, v_ip from auth.sessions s where s.id = new.session_id;
  if v_user is null then return null; end if;
  select c.id into v_colab from public."Colaborador" c where c."userId" = v_user limit 1;
  if v_colab is null then return null; end if;

  if exists (select 1 from public."AuditoriaEvento"
              where modulo = 'acesso' and acao = 'login' and "atorId" = v_colab
                and "criadoEm" > now() - interval '2 minutes') then
    return null;
  end if;

  v_como := case new.authentication_method
    when 'otp' then 'Link ou código por e-mail'
    when 'magiclink' then 'Link de acesso'
    when 'password' then 'Senha'
    else new.authentication_method end;
  v_info := jsonb_build_array(jsonb_build_object('rotulo', 'Como', 'valor', v_como));
  if v_ip is not null then
    v_info := v_info || jsonb_build_array(jsonb_build_object('rotulo', 'IP', 'valor', host(v_ip)));
  end if;

  perform public.auditoria_registrar('acesso', 'colaborador', v_colab::text, 'login', 'entrou no painel',
    jsonb_build_object('info', v_info), 'painel', null, null, null, v_colab);
  return null;
exception when others then
  raise warning 'auditoria_login_sessao: %', sqlerrm;
  return null;
end $$;

revoke all on function public.auditoria_login_sessao() from public, anon, authenticated;

drop trigger if exists auditoria_login_sessao on auth.mfa_amr_claims;
create trigger auditoria_login_sessao
  after insert on auth.mfa_amr_claims
  for each row execute function public.auditoria_login_sessao();

-- ---------------------------------------------------------------------------
-- 2. registrar_login: a tela só refina o "Como" (link x código)
-- ---------------------------------------------------------------------------
-- Continua com a mesma assinatura (a tela chama depois de verifyOtp). Regras:
--   * só vale para sessão que nasceu de token do e-mail (amr otp/magiclink no
--     JWT): uma sessão do Google não vira "código";
--   * se o gatilho já gravou "Link ou código por e-mail" há menos de 2 minutos,
--     troca só o "Como" desse evento;
--   * se não existe evento recente nenhum (gatilho ausente), grava como antes;
--   * qualquer outro caso (ex.: "Só com o e-mail"), não mexe.
create or replace function public.registrar_login(p_metodo text default 'link')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := public.eu_colaborador_id();
  v_como text := case p_metodo when 'codigo' then 'Código por e-mail' else 'Link de acesso' end;
  v_ev public."AuditoriaEvento"%rowtype;
begin
  if v_eu is null or p_metodo not in ('link', 'codigo') then return; end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) e
     where e ->> 'method' in ('otp', 'magiclink')) then
    return;
  end if;

  select * into v_ev from public."AuditoriaEvento"
   where modulo = 'acesso' and acao = 'login' and "atorId" = v_eu
     and "criadoEm" > now() - interval '2 minutes'
   order by id desc limit 1;

  if not found then
    perform public.auditoria_registrar('acesso', 'colaborador', v_eu::text, 'login', 'entrou no painel',
      jsonb_build_object('info', public.auditoria_info('Como', v_como)),
      'painel', null, null, null, v_eu);
    return;
  end if;

  if v_ev.detalhes -> 'info' -> 0 ->> 'valor' = 'Link ou código por e-mail' then
    update public."AuditoriaEvento"
       set detalhes = jsonb_set(detalhes, '{info,0,valor}', to_jsonb(v_como))
     where id = v_ev.id;
  end if;
end $$;

revoke all on function public.registrar_login(text) from public, anon;
grant execute on function public.registrar_login(text) to authenticated;
