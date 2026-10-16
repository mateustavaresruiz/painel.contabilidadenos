# Design do painel Denos

> **Nova direção (15/10/2026, aprovada pelo dono):** o visual austero abaixo ficou "sem vida".
> Agora vale: cor da marca, cor por módulo, sombra suave em cartão, gradiente leve, imagem e
> movimento. Onde esta seção contradiz o resto do arquivo, **esta seção vence**.
>
> - **Marca:** marinho da logo NÓS `--brand` #1b396d (amostrado de `public/logo.png`; escuro #13294f).
>   Botões e links no azul vivo `--primary` #1f6feb (escuro #4c8dff).
> - **Cores por módulo** (`--mod-*` em index.css, claro e escuro; helper `lib/cores-modulo.ts`):
>   WhatsApp verde, Chamados laranja, Clientes azul, Certificados roxo, Pendências fiscais vermelho,
>   Equipe teal, Configurações ardósia, Início marinho. Uso: `style={corModulo("chamados")}` mais as
>   classes `chip-mod` (ícone em chip com fundo a 13%), `texto-mod` (número, link) ou `var(--mc)`.
> - **Profundidade:** cartões podem ter sombra suave (`shadow-card`, `--sombra-card`) e subir no
>   hover (`cartao-vivo`). Gradiente leve da cor do módulo é permitido em cartão de destaque.
> - **Fonte:** Plus Jakarta Sans (variável, `@fontsource-variable/plus-jakarta-sans`), corpo e
>   títulos; pesos 400/500/600/700. Tracking 0 no corpo, -0.015em em título.
> - **Estilo do app** (Config `aparencia.estilo`, vale para todos; troca na pílula do Início para
>   quem tem configuracoes.gerenciar): **A Marinho** (menu marinho com logo branca, banner com a foto
>   do prédio) ou **B Claro e colorido** (menu claro, cartões com faixa colorida, ícones em círculos
>   cheios, ilustrações de ícones lucide em bolhas). Padrão A. Os tokens `--sidebar-*` mudam com
>   `html[data-estilo]`.
> - **Logo:** grande. Menu aberto 48px de altura, recolhido 44px, cabeçalho do celular 44px, banner
>   do Início 72px.
> - **Movimento:** números contam até o valor (requestAnimationFrame), entrada escalonada, cartões
>   sobem no hover; tudo respeita `prefers-reduced-motion`.
> - **Início sem nada técnico:** saudação, "o que precisa de você hoje", atalhos e resumos em
>   linguagem simples. Saúde das integrações, tempo de resposta e conexões ficam só em
>   Configurações > Integrações.

## Identidade (15/10/2026, segunda passada; vence o que vier abaixo)

- **Uma cor para interação:** azul `--primary` em botão, link, foco e item ativo do menu. Item ativo
  = ícone + texto azuis, fundo azul suave (`--sidebar-active`) e barrinha de 3px à esquerda. **Nada
  de cor de módulo no menu** (o chip colorido saiu: ícone vermelho + texto azul ficava feio).
- **Cor de módulo só dentro da página e com parcimônia:** quadrado do ícone do cabeçalho, números
  de KPI, ilustração de estado vazio.
- **Cabeçalho padrão** (`components/page-header.tsx`) em toda página: quadrado do ícone na cor do
  módulo (deduzida do caminho; `cor` sobrepõe), título 28/700 (22 no celular), descrição de uma
  linha, ação principal à direita (no celular desce), faixa com gradiente leve e o hexágono da
  marca apagado no canto. `topo` recebe o link "Voltar".
- **Hexágono NÓS** (`components/marca-hexagono.tsx`): sempre a imagem `public/favicon.png`, nunca
  desenho refeito. Marca d'água (`MarcaDagua`) nos cabeçalhos e no banner do Início; pulsando na
  tela de carregamento (`CarregandoMarca`); marca do menu recolhido.
- **Avatares:** iniciais em cor suave determinística (`components/avatar-iniciais.tsx`, classe
  `avatar-suave`) para clientes e contatos; equipe usa `Colaborador.cor` em tom suave
  (`avatar-cor`). No WhatsApp, foto > iniciais (nome com letra) > desenho fictício.
- **Contadores no menu:** WhatsApp (conversas com não lidas) e Chamados (abertos comigo + atrasados),
  só `count head`, cache 60 s, sem polling (`lib/queries/contadores.ts`).
- **Estado vazio** (`components/ui/empty-state.tsx`): ícone lucide em círculo tingido da cor do
  módulo, halo e dois satélites; texto curto e ação principal.
- **Barra de topo do desktop:** busca global Ctrl+K (`components/busca-global.tsx`: páginas,
  clientes e conversas pelo nome) e o menu da conta (avatar). No celular a conta fica no cabeçalho.
- **Listas:** linhas mais altas com avatar; ações aparecem no hover com tooltip.

Base: análise do design da Apple enviada pelo dono em 14/10/2026 ("Apple-design-analysis").
Aqui está a tradução daquele sistema para um **painel de trabalho** (denso, cheio de listas e
formulários), não para uma vitrine de produto. Onde a referência fala de "product tile" e
fotografia, o painel não usa; o resto vale.

## Tokens

### Cores (claro)
| Token | Hex | Uso |
|---|---|---|
| `--primary` | `#0066cc` | Único acento. Todo elemento clicável: botão principal, link, item ativo do menu, foco |
| `--primary-focus` | `#0071e3` | Anel de foco (outline 2px) |
| `--ink` | `#1d1d1f` | Todo texto principal |
| `--ink-80` | `#333333` | Texto em botão secundário (pearl) |
| `--ink-48` | `#6b6b6b` | Texto secundário, legenda, desabilitado |
| `--canvas` | `#ffffff` | Cartões, painéis, conversa |
| `--parchment` | `#f5f5f7` | Fundo da página, menu lateral, cabeçalho de tabela |
| `--pearl` | `#fafafc` | Botão secundário |
| `--hairline` | `#e0e0e0` | Borda 1px de cartão, input, divisória |
| `--divider-soft` | `#f0f0f0` | Divisória entre linhas de lista |
| `--chip` | `rgba(210,210,215,.64)` | Botão de ícone circular |

Estados semânticos (o painel precisa; a referência não tem): usar com parcimônia, só em
badge/indicador, nunca em botão. Sucesso `#1f8a3b`, atenção `#b25000`, erro `#d70015`.
Fundo do badge = a cor a 10% de opacidade.

### Cores (escuro)
A referência não documenta modo escuro de interface; derivado das superfícies escuras dela:
fundo `#000000` → usar `#1d1d1f` no fundo, `#272729` em cartões, `#2a2a2c` em elevação,
texto `#f5f5f7`, secundário `#a1a1a6`, borda `rgba(255,255,255,.12)`, acento `#2997ff`
(o azul da Apple para superfície escura; `#0066cc` some no escuro).

### Tipografia
Pilha: `system-ui, -apple-system, BlinkMacSystemFont, "Inter", sans-serif` (no Mac/iPhone
vira SF Pro; fora dele, Inter). Pesos 400 e 600 (300 só em número grande de dashboard).
Sem 500 e sem 700.

| Papel | Tamanho / peso / altura / tracking |
|---|---|
| Título de página | 28px / 600 / 1.14 / -0.28px |
| Título de seção/cartão | 21px / 600 / 1.19 / -0.2px |
| Corpo | 15px / 400 / 1.47 / -0.24px (painel: 15px, não 17, pela densidade) |
| Corpo forte | 15px / 600 |
| Legenda, rótulo, tabela | 13px / 400 / 1.38 / -0.08px |
| Miúdo (hora, contador) | 12px / 400 / -0.12px |
| Número de destaque (Início) | 34px / 600 / -0.374px |

### Raios
`8px` botão utilitário, input, item de menu · `11px` botão pearl · `18px` cartão e diálogo ·
`9999px` botão primário, chip de filtro, busca, badge. Nada fora dessa escala.

### Espaçamento
Base 8: 4 · 8 · 12 · 16 · 24 · 32 · 48. Padding de cartão 24px; de página 32px (16px no
celular).

### Profundidade
- ~~Sem sombra em cartão~~ (revogado: sombra suave em cartão permitida). Sem sombra em botão ou texto. Separação = borda 1px `--hairline` ou troca de superfície
  (`--parchment` ↔ `--canvas`).
- Barras fixas (cabeçalho, barra da conversa, composer) usam `--parchment` a 80% com
  `backdrop-filter: saturate(180%) blur(20px)`.
- Única sombra permitida: popovers/menus/diálogos flutuando sobre conteúdo
  (`0 8px 30px rgba(0,0,0,.12)`) — é o equivalente funcional do "produto sobre a superfície".

## Componentes
- **Botão primário**: `--primary`, texto branco, pílula, 8px 18px, 15px/400. Ativo: `scale(.95)`.
- **Botão secundário**: fundo transparente, texto e borda 1px `--primary`, pílula.
- **Botão utilitário**: fundo `--ink`, texto branco, raio 8px, 13px.
- **Botão pearl** (ação neutra em cartão): `--pearl`, texto `--ink-80`, raio 11px, borda 1px `--divider-soft`.
- **Ícone circular**: 36px (44px no celular), fundo `--chip`.
- **Input**: `--canvas`, borda 1px `--hairline`, raio 8px, altura 40px; foco = outline 2px `--primary-focus`.
  Rótulo acima (13px/600), erro abaixo em `--erro`.
- **Busca**: input em pílula com ícone à esquerda.
- **Cartão**: `--canvas`, borda 1px `--hairline`, raio 18px, padding 24px, sem sombra.
- **Menu lateral**: `--parchment`, itens 13px, raio 8px; ativo = texto `--primary` + fundo `--primary` a 8%.
- **Chip de filtro**: pílula, borda 1px `--hairline`; selecionado = borda 2px `--primary-focus`.
- **Tabela/lista**: cabeçalho 12px `--ink-48`, linhas separadas só por `--divider-soft`, sem zebra.
- **Balões do WhatsApp**: meu = `--primary` a 10% sobre `--canvas`; do contato = `--parchment`.
  Raio 18px. Mensagem do sistema/transferência = 12px `--ink-48` centralizada, sem balão.

## Regras
- ~~Um acento só~~ (revogado: marca e cores por módulo). Status (vencido, aberto, concluído) é badge, nunca botão colorido.
- ~~Nada de gradiente~~ (revogado: gradiente leve da cor do módulo é permitido; sem glow).
- Ícones: uma família só, traço 1.5.
- Sem travessão (—) em texto de interface.
- Estados de carregando (skeleton com a forma final), vazio (como popular) e erro em toda lista.

## Movimento
Curto e discreto; tudo respeita `prefers-reduced-motion` (index.css zera as animações).
- **Troca de página**: pelo menu, View Transition só no conteúdo (sai 120ms, entra opacidade
  + 4px em 180ms); sem suporte, ou por link dentro da página, a classe `animate-page-enter`.
  O chunk da página é pré-carregado no hover/foco do item e no tempo ocioso (`routes/paginas.ts`).
- **Pressionar**: botão, chip, aba e item clicável `scale(.97)`.
- **Diálogo, popover, select**: fade + `scale(.98)`, 150ms. Sem deslize.
- **Carregando**: skeleton com a forma final (`components/ui/skeleton.tsx`), nunca spinner
  solto no meio da página. Botão esperando: `loading` (spinner por cima, largura não muda).
- **Lista que refaz com filtro/busca**: mantém a anterior esmaecida (`keepPreviousData`).
- **Menu lateral**: recolhível no desktop (só ícones, lembrado no navegador, Ctrl/⌘+B).

## Padrões de tela
- Cabeçalho: `PageHeader` (título 28/600, descrição curta, ação principal à direita).
- Abas: uma pílula só (`TabsList` e `ModuloAbas` com o mesmo visual).
- Filtros de período/estado: `Chips` (selecionado = anel de 2px no azul de foco).
- Barra de filtros: cartão com campos de 40px; data com o rótulo dentro do campo.
- Vazio: `EmptyState` com a próxima ação (ex.: "Limpar filtros" quando há filtro).
