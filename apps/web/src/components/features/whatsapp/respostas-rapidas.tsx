import { MessageSquareText, Search, Settings } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePermissao } from "@/lib/colaborador";
import { filtrarRespostas, preencherVariaveis, type RespostaRapida } from "@/lib/respostas-rapidas";
import { cn } from "@/lib/utils";

// Respostas rápidas no composer: o botão (popover com busca) e o menu do
// atalho "/" no início do campo. Os dois só INSEREM o texto no campo; quem
// envia é a pessoa, depois de revisar. Dados e variáveis em lib/respostas-rapidas.

/** Lista de respostas com a ativa destacada (teclado ↑↓ ou mouse). */
function ListaRespostas({
  idBase,
  itens,
  ativo,
  nome,
  onEscolher,
  onAtivar,
}: {
  idBase: string;
  itens: RespostaRapida[];
  ativo: number;
  /** Nome do contato: a prévia já mostra o texto com as variáveis trocadas. */
  nome: string | null;
  onEscolher: (r: RespostaRapida) => void;
  onAtivar: (i: number) => void;
}) {
  // Ao andar com as setas, a ativa fica sempre à vista. Rola só a lista (não
  // scrollIntoView, que também rolaria os contêineres da conversa).
  const listaRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const ul = listaRef.current;
    const li = ul?.children[ativo] as HTMLElement | undefined;
    if (!ul || !li) return;
    if (li.offsetTop < ul.scrollTop) ul.scrollTop = li.offsetTop;
    else if (li.offsetTop + li.offsetHeight > ul.scrollTop + ul.clientHeight) {
      ul.scrollTop = li.offsetTop + li.offsetHeight - ul.clientHeight;
    }
  }, [ativo]);

  return (
    <ul
      ref={listaRef}
      id={idBase}
      role="listbox"
      aria-label="Respostas rápidas"
      className="relative max-h-[min(16rem,40vh)] overflow-y-auto overscroll-contain p-1"
    >
      {itens.map((r, i) => (
        <li
          key={`${r.titulo}-${i}`}
          id={`${idBase}-${i}`}
          role="option"
          aria-selected={i === ativo}
          // mousedown, não click: não tira o foco do campo antes de inserir.
          onMouseDown={(e) => {
            e.preventDefault();
            onEscolher(r);
          }}
          onMouseEnter={() => onAtivar(i)}
          className={cn(
            "cursor-pointer rounded-md px-2.5 py-2 toque:min-h-11",
            i === ativo ? "bg-accent" : "hover:bg-accent/60",
          )}
        >
          <p className="truncate text-sm font-medium">{r.titulo}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{preencherVariaveis(r.texto, nome)}</p>
        </li>
      ))}
    </ul>
  );
}

/** Rodapé com a dica do atalho e, para quem gerencia, o link para editar. */
function RodapeRespostas() {
  const podeEditar = usePermissao("configuracoes.gerenciar");
  return (
    <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-2xs text-muted-foreground">
      <span>
        Digite <kbd className="rounded border bg-muted px-1 font-mono">/</kbd> no início do campo para buscar
      </span>
      {podeEditar && (
        <Link
          to="/configuracoes?tab=geral"
          className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
        >
          <Settings className="size-3" />
          Editar
        </Link>
      )}
    </div>
  );
}

/** Botão ao lado do emoji: abre a lista com busca. Clique ou Enter insere. */
export function RespostasRapidasBotao({
  respostas,
  nome,
  onEscolher,
  disabled,
}: {
  respostas: RespostaRapida[];
  nome: string | null;
  onEscolher: (r: RespostaRapida) => void;
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState(0);
  const idBase = useId();
  const itens = filtrarRespostas(respostas, busca);

  function escolher(r: RespostaRapida) {
    setAberto(false);
    onEscolher(r);
  }

  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        if (o) {
          setBusca("");
          setAtivo(0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 toque:size-11"
          disabled={disabled}
          title="Respostas rápidas"
          aria-label="Respostas rápidas"
        >
          <MessageSquareText className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-[min(360px,calc(100vw-2rem))] p-0"
        // O foco volta para o campo pelo próprio Composer, já com o cursor no lugar.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setAtivo(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setAtivo((a) => Math.min(a + 1, itens.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setAtivo((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  const r = itens[ativo];
                  if (r) escolher(r);
                }
              }}
              placeholder="Buscar resposta"
              aria-label="Buscar resposta rápida"
              aria-controls={idBase}
              aria-activedescendant={itens[ativo] ? `${idBase}-${ativo}` : undefined}
              className="h-9 pl-8"
            />
          </div>
        </div>
        {itens.length > 0 ? (
          <ListaRespostas
            idBase={idBase}
            itens={itens}
            ativo={ativo}
            nome={nome}
            onEscolher={escolher}
            onAtivar={setAtivo}
          />
        ) : (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {respostas.length === 0 ? "Nenhuma resposta rápida cadastrada." : "Nenhuma resposta com esse termo."}
          </p>
        )}
        <RodapeRespostas />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Menu do atalho "/": aparece acima do campo enquanto o texto é "/termo".
 * O teclado (↑↓, Enter, Esc) fica no campo; o Composer controla `ativo`.
 */
export function MenuRespostasBarra({
  idBase,
  itens,
  ativo,
  nome,
  onEscolher,
  onAtivar,
}: {
  idBase: string;
  itens: RespostaRapida[];
  ativo: number;
  nome: string | null;
  onEscolher: (r: RespostaRapida) => void;
  onAtivar: (i: number) => void;
}) {
  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-card border border-border bg-popover text-popover-foreground shadow-flutuante animate-in fade-in-0 zoom-in-[.98] duration-150">
      <p className="flex items-center gap-1.5 border-b px-3 py-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        <MessageSquareText className="size-3" />
        Respostas rápidas
        <span className="ml-auto normal-case tracking-normal toque:hidden">↑↓ escolhe · Enter insere · Esc fecha</span>
      </p>
      <ListaRespostas
        idBase={idBase}
        itens={itens}
        ativo={ativo}
        nome={nome}
        onEscolher={onEscolher}
        onAtivar={onAtivar}
      />
    </div>
  );
}
