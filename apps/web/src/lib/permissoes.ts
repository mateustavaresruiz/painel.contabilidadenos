// Catálogo de permissões dos cargos. A mesma lista mora no banco (tabela
// "Permissao", migration 005), que é quem valida os cargos e aplica a RLS.
// Mudou aqui? Mude lá também (nova migration).

export type PermissaoDef = { chave: string; rotulo: string; descricao: string };
export type GrupoPermissoes = { modulo: string; permissoes: PermissaoDef[] };

export const CATALOGO_PERMISSOES: GrupoPermissoes[] = [
  {
    modulo: "WhatsApp",
    permissoes: [
      { chave: "whatsapp.ver", rotulo: "Abrir o WhatsApp", descricao: "Vê as conversas sem responsável e as suas." },
      { chave: "whatsapp.ver_todas", rotulo: "Ver todas as conversas", descricao: "Vê também as conversas de outras pessoas da equipe." },
      { chave: "whatsapp.responder", rotulo: "Responder", descricao: "Envia mensagens, áudios e arquivos, reage e encaminha." },
      { chave: "whatsapp.assumir", rotulo: "Assumir conversa", descricao: "Fica como responsável por uma conversa sem responsável." },
      { chave: "whatsapp.transferir", rotulo: "Transferir conversa", descricao: "Passa a conversa para outra pessoa ou a devolve à fila." },
      { chave: "whatsapp.assumir_de_outros", rotulo: "Assumir conversa de outra pessoa", descricao: "Supervisão: assume, finaliza e responde conversas que estão em atendimento por outra pessoa." },
      { chave: "whatsapp.apagar_mensagens", rotulo: "Apagar mensagens e conversas", descricao: "Apaga mensagens enviadas e limpa ou remove conversas." },
      { chave: "whatsapp.exportar", rotulo: "Exportar conversa", descricao: "Baixa a conversa em PDF ou texto." },
      { chave: "whatsapp.conexoes", rotulo: "Gerenciar números", descricao: "Conecta, desconecta, cria e apaga as conexões do WhatsApp." },
    ],
  },
  {
    modulo: "Chamados",
    permissoes: [
      { chave: "chamados.ver", rotulo: "Ver chamados", descricao: "Vê todos os chamados. Sem ela, só os que criou ou dos quais é responsável." },
      { chave: "chamados.criar", rotulo: "Abrir chamado", descricao: "Abre chamados, inclusive pela conversa." },
      { chave: "chamados.gerenciar", rotulo: "Gerenciar chamados", descricao: "Muda status e responsável de qualquer chamado e exclui." },
      { chave: "chamados.tipos", rotulo: "Tipos de chamado", descricao: "Cria, edita e desativa os tipos de chamado." },
      { chave: "chamados.relatorio", rotulo: "Relatório de chamados", descricao: "Vê o relatório de tipos mais pedidos." },
    ],
  },
  {
    modulo: "Clientes",
    permissoes: [
      { chave: "clientes.ver", rotulo: "Ver clientes", descricao: "Abre a lista e a ficha dos clientes." },
      { chave: "clientes.editar", rotulo: "Cadastrar e editar", descricao: "Cadastra e altera clientes e sócios." },
      { chave: "clientes.excluir", rotulo: "Excluir clientes", descricao: "Exclui clientes (some o histórico ligado a eles)." },
      { chave: "aniversarios.ver", rotulo: "Ver aniversários", descricao: "Abre a lista de aniversários de clientes e sócios." },
    ],
  },
  {
    modulo: "Certificados",
    permissoes: [
      { chave: "certificados.ver", rotulo: "Ver certificados", descricao: "Vê os certificados digitais e a validade." },
      { chave: "certificados.editar", rotulo: "Cadastrar e editar", descricao: "Cadastra, renova e exclui certificados." },
      { chave: "certificados.configurar_avisos", rotulo: "Configurar avisos", descricao: "Muda marcos, mensagem e número dos avisos de vencimento." },
    ],
  },
  {
    modulo: "Pendências fiscais",
    permissoes: [
      { chave: "serpro.consultar", rotulo: "Consultar", descricao: "Faz consultas ao Serpro e baixa os relatórios." },
      { chave: "serpro.confirmar_pin", rotulo: "Confirmar com PIN", descricao: "Confirma serviços do Serpro que pedem PIN (podem ter custo)." },
      { chave: "serpro.agendar", rotulo: "Agendar consultas", descricao: "Liga, desliga e muda os agendamentos automáticos do Serpro (cada consulta é cobrada)." },
    ],
  },
  {
    modulo: "Início",
    permissoes: [{ chave: "dashboard.ver", rotulo: "Ver números do escritório", descricao: "Vê os indicadores e gráficos do Início." }],
  },
  {
    modulo: "Equipe",
    permissoes: [
      { chave: "equipe.ver", rotulo: "Ver equipe", descricao: "Abre a página Equipe." },
      { chave: "equipe.gerenciar", rotulo: "Gerenciar equipe e cargos", descricao: "Convida, edita, desativa pessoas e cria e edita cargos." },
    ],
  },
  {
    modulo: "Configurações",
    permissoes: [
      { chave: "configuracoes.gerenciar", rotulo: "Configurações do painel", descricao: "Módulos, integrações, marca e sistema." },
      { chave: "auditoria.ver", rotulo: "Ver a auditoria", descricao: "Vê o histórico completo do painel: quem fez o quê e quando, em todos os módulos." },
    ],
  },
];

export const TODAS_PERMISSOES: string[] = CATALOGO_PERMISSOES.flatMap((g) => g.permissoes.map((p) => p.chave));

// Hooks: usePermissao / useAlgumaPermissao em lib/colaborador.tsx.
