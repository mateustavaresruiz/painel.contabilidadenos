# Design do painel Denos

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
| `--ink-48` | `#7a7a7a` | Texto secundário, legenda, desabilitado |
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
- Sem sombra em cartão, botão ou texto. Separação = borda 1px `--hairline` ou troca de superfície
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
- Um acento só. Status (vencido, aberto, concluído) é badge, nunca botão colorido.
- Nada de gradiente, brilho, glow, ponto colorido decorativo.
- Ícones: uma família só, traço 1.5.
- Sem travessão (—) em texto de interface.
- Estados de carregando (skeleton com a forma final), vazio (como popular) e erro em toda lista.
