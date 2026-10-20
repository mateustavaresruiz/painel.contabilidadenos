-- 024 — Anotações na ficha do cliente
--
-- RPC comentar_cliente: grava uma anotação (texto livre, com data e autor) na
-- AuditoriaEvento com "clienteId" preenchido, e ela aparece na aba Histórico
-- da ficha (historico_entidade com entidade 'cliente', migration 018). Mesmo
-- molde de comentar_chamado (009): modulo 'clientes', entidade 'cliente',
-- acao 'comentario' e detalhes {texto}, que a linha do tempo já desenha.
--
-- Exige clientes.ver, a mesma regra que abre o histórico do cliente.
--
-- Não destrutiva: só cria (ou troca) uma função. Pode rodar mais de uma vez.

create or replace function public.comentar_cliente(p_cliente text, p_texto text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := public.eu_colaborador_id();
  v_nome text;
  v_texto text := trim(coalesce(p_texto, ''));
  v_id bigint;
begin
  if v_eu is null then
    raise exception 'Acesso não liberado.' using errcode = '42501';
  end if;
  if not public.tem_permissao('clientes.ver') then
    raise exception 'Sem acesso a este cliente.' using errcode = '42501';
  end if;
  select coalesce(nullif(trim("nomeFantasia"), ''), nome) into v_nome
    from public."Cliente" where id = p_cliente;
  if not found then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;
  if length(v_texto) < 1 then
    raise exception 'Escreva a anotação.' using errcode = 'P0001';
  end if;
  if length(v_texto) > 2000 then
    raise exception 'A anotação passa de 2000 caracteres.' using errcode = 'P0001';
  end if;
  v_id := public.auditoria_registrar('clientes', 'cliente', p_cliente, 'comentario',
    'anotou no cadastro de ' || coalesce(v_nome, 'cliente'),
    jsonb_build_object('texto', v_texto), 'painel', p_cliente, null, null, v_eu);
  -- auditoria_registrar engole o erro e devolve null (para não derrubar quem
  -- chama). Aqui a anotação É a operação: sem gravar, avisa em vez de sumir.
  if v_id is null then
    raise exception 'Não deu para gravar a anotação. Tente de novo.' using errcode = 'P0001';
  end if;
  return v_id;
end $$;

revoke all on function public.comentar_cliente(text, text) from public, anon;
grant execute on function public.comentar_cliente(text, text) to authenticated;

comment on function public.comentar_cliente(text, text) is
  'Anotação na ficha do cliente (aba Histórico). Grava em AuditoriaEvento como comentário, com autor e data.';
