-- 019 · Status do chamado no masculino também na auditoria
--
-- Não destrutiva: só substitui a função do gatilho de Solicitacao (mesmo corpo
-- da 012). Os valores do banco continuam aberta/em_andamento/concluida/cancelada;
-- muda só o texto que a linha do tempo mostra ("de Aberto para Concluído"),
-- igual aos rótulos da tela. Eventos já gravados ficam como estão.

create or replace function public.trg_auditoria_solicitacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public."Solicitacao";
  v_tipo text;
  v_cli text;
  v_de text;
  v_para text;
  v_st jsonb := jsonb_build_object('aberta','Aberto','em_andamento','Em andamento','concluida','Concluído','cancelada','Cancelado');
begin
  begin
    if tg_op = 'DELETE' then r := old; else r := new; end if;
    select nome into v_tipo from public."SolicitacaoTipo" where id = r."tipoId";
    v_tipo := coalesce(v_tipo, 'Chamado');
    v_cli := public.auditoria_cliente_nome(r."clienteId");

    if tg_op = 'INSERT' then
      -- Chamado aberto pelo portal: a function do portal já registra o evento ("Cliente (portal)
      -- abriu..."). Sem este corte saía um segundo, do "Sistema", para o mesmo chamado.
      if r.origem = 'portal' then
        return null;
      end if;
      perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'criado',
        'abriu o chamado «' || v_tipo || '»' || coalesce(' para ' || v_cli, '')
          || case when r."chatId" is not null then ' (pela conversa do WhatsApp)' else '' end,
        jsonb_build_object('info', public.auditoria_info(
          'Tipo', v_tipo, 'Cliente', v_cli, 'Status', v_st ->> r.status,
          'Responsável', public.auditoria_colab_nome(r."responsavelId"),
          'Prazo', public.auditoria_dia(r.prazo), 'Descrição', left(r.descricao, 500))),
        'sistema', r."clienteId", r."chatId", r.id, r."criadoPorId");

    elsif tg_op = 'DELETE' then
      perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'excluido',
        'excluiu o chamado «' || v_tipo || '»' || coalesce(' de ' || v_cli, ''),
        jsonb_build_object('info', public.auditoria_info(
          'Tipo', v_tipo, 'Cliente', v_cli, 'Status', v_st ->> r.status, 'Descrição', left(r.descricao, 500))),
        'sistema', r."clienteId", r."chatId", r.id);

    else
      if new.status is distinct from old.status then
        perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'status',
          'mudou o status do chamado «' || v_tipo || '» de ' || coalesce(v_st ->> old.status, old.status)
            || ' para ' || coalesce(v_st ->> new.status, new.status),
          jsonb_build_object('alteracoes', public.auditoria_alt('status', 'Status',
            v_st ->> old.status, v_st ->> new.status)),
          'sistema', r."clienteId", r."chatId", r.id);
      end if;
      if new."responsavelId" is distinct from old."responsavelId" then
        v_de := public.auditoria_colab_nome(old."responsavelId");
        v_para := public.auditoria_colab_nome(new."responsavelId");
        perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'responsavel',
          case when old."responsavelId" is null then 'definiu ' || coalesce(v_para, 'alguém') || ' como responsável pelo chamado «' || v_tipo || '»'
               when new."responsavelId" is null then 'tirou o responsável (' || coalesce(v_de, 'alguém') || ') do chamado «' || v_tipo || '»'
               else 'passou o chamado «' || v_tipo || '» de ' || coalesce(v_de, 'alguém') || ' para ' || coalesce(v_para, 'alguém') end,
          jsonb_build_object('alteracoes', public.auditoria_alt('responsavelId', 'Responsável', v_de, v_para)),
          'sistema', r."clienteId", r."chatId", r.id);
      end if;
      if new.prazo is distinct from old.prazo then
        perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'prazo',
          case when old.prazo is null then 'definiu o prazo do chamado «' || v_tipo || '» para ' || public.auditoria_dia(new.prazo)
               when new.prazo is null then 'tirou o prazo do chamado «' || v_tipo || '»'
               else 'mudou o prazo do chamado «' || v_tipo || '» de ' || public.auditoria_dia(old.prazo) || ' para ' || public.auditoria_dia(new.prazo) end,
          jsonb_build_object('alteracoes', public.auditoria_alt('prazo', 'Prazo',
            public.auditoria_dia(old.prazo), public.auditoria_dia(new.prazo))),
          'sistema', r."clienteId", r."chatId", r.id);
      end if;
      if new.descricao is distinct from old.descricao then
        perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'descricao',
          'editou a descrição do chamado «' || v_tipo || '»',
          jsonb_build_object('alteracoes', public.auditoria_alt('descricao', 'Descrição',
            left(old.descricao, 500), left(new.descricao, 500))),
          'sistema', r."clienteId", r."chatId", r.id);
      end if;
      if new."tipoId" is distinct from old."tipoId" then
        select nome into v_de from public."SolicitacaoTipo" where id = old."tipoId";
        perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'tipo',
          'mudou o tipo do chamado de «' || coalesce(v_de, '?') || '» para «' || v_tipo || '»',
          jsonb_build_object('alteracoes', public.auditoria_alt('tipoId', 'Tipo', v_de, v_tipo)),
          'sistema', r."clienteId", r."chatId", r.id);
      end if;
      if new."clienteId" is distinct from old."clienteId" then
        v_de := public.auditoria_cliente_nome(old."clienteId");
        perform public.auditoria_registrar('chamados', 'solicitacao', r.id, 'cliente',
          case when new."clienteId" is null then 'tirou o cliente (' || coalesce(v_de, '?') || ') do chamado «' || v_tipo || '»'
               when old."clienteId" is null then 'ligou o chamado «' || v_tipo || '» ao cliente ' || coalesce(v_cli, '?')
               else 'mudou o cliente do chamado «' || v_tipo || '» de ' || coalesce(v_de, '?') || ' para ' || coalesce(v_cli, '?') end,
          jsonb_build_object('alteracoes', public.auditoria_alt('clienteId', 'Cliente', v_de, v_cli)),
          'sistema', coalesce(new."clienteId", old."clienteId"), r."chatId", r.id);
      end if;
    end if;
  exception when others then
    raise warning 'trg_auditoria_solicitacao: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."Solicitacao";
create trigger trg_auditoria after insert or update or delete on public."Solicitacao"
  for each row execute function public.trg_auditoria_solicitacao();

revoke all on function public.trg_auditoria_solicitacao() from public, anon, authenticated;
