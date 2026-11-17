-- 027 · Login com senha: quando cada pessoa criou (ou trocou) a senha
--
-- Não destrutiva e idempotente: uma coluna nova (nula), uma função e um gatilho.
-- Nenhuma linha existente é apagada; nenhuma senha é lida nem guardada aqui.
--
-- Por que uma coluna e não "auth.users.encrypted_password vazio": o Auth
-- (GoTrue v2.196, internal/api/admin.go) cria o usuário convidado pela function
-- `equipe` com uma senha ALEATÓRIA de 64 caracteres quando nenhuma é informada.
-- Todo mundo "tem senha" no Auth, mas ninguém a conhece. O que importa para o
-- painel é se a PESSOA já escolheu a dela, e isso só se sabe pelo momento em
-- que a senha muda depois do convite.
--
--   * "Colaborador"."senhaDefinidaEm": nula = a pessoa nunca criou a senha
--     (a tela de entrada por link a leva para "Crie sua senha"); preenchida =
--     data da última vez que criou ou trocou. Equipe mostra quem falta.
--   * Gatilho em auth.users: quando encrypted_password muda (o Auth só grava
--     essa coluna ao trocar a senha: PUT /user, admin), preenche a data e
--     grava na auditoria "criou a senha de acesso" / "trocou a senha de acesso".
--     Criar o usuário (INSERT) não conta: é a senha aleatória do convite.
--
-- Quem já existe começa com a coluna nula (antes não havia senha no painel).
-- O gatilho roda dentro da transação do Auth: qualquer erro vira só um aviso
-- no log do banco e nunca impede a troca de senha.

alter table public."Colaborador" add column if not exists "senhaDefinidaEm" timestamptz;

comment on column public."Colaborador"."senhaDefinidaEm" is
  'Quando a pessoa criou ou trocou a senha de acesso (gatilho em auth.users). Nula = ainda sem senha própria.';

create or replace function public.senha_definida_auth()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_colab uuid;
  v_primeira boolean;
begin
  select c.id, c."senhaDefinidaEm" is null into v_colab, v_primeira
    from public."Colaborador" c where c."userId" = new.id limit 1;
  if v_colab is null then return null; end if;

  update public."Colaborador" set "senhaDefinidaEm" = now() where id = v_colab;

  perform public.auditoria_registrar('acesso', 'colaborador', v_colab::text, 'senha',
    case when v_primeira then 'criou a senha de acesso' else 'trocou a senha de acesso' end,
    null, 'painel', null, null, null, v_colab);
  return null;
exception when others then
  raise warning 'senha_definida_auth: %', sqlerrm;
  return null;
end $$;

revoke all on function public.senha_definida_auth() from public, anon, authenticated;

drop trigger if exists senha_definida on auth.users;
create trigger senha_definida
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password
        and coalesce(new.encrypted_password, '') <> '')
  execute function public.senha_definida_auth();
