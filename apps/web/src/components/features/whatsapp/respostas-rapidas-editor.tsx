import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { usePermissao } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import {
  RESPOSTAS_PADRAO,
  useRespostasRapidas,
  useSalvarRespostasRapidas,
  type RespostaRapida,
} from "@/lib/respostas-rapidas";
import { plural } from "@/lib/texto";
import { toast } from "@/lib/toast";

type Item = RespostaRapida & { _id: string };

/**
 * Card "Respostas rápidas do WhatsApp" de Configurações > Geral: incluir,
 * editar, remover e reordenar. Grava a lista inteira na Config
 * ('whatsapp.respostasRapidas'); só configuracoes.gerenciar grava (RLS), e a
 * aba Geral já é desse cargo.
 */
export function RespostasRapidasEditor() {
  const podeGerenciar = usePermissao("configuracoes.gerenciar");
  const { respostas, salvas, isLoading } = useRespostasRapidas();
  const { salvar, pendente } = useSalvarRespostasRapidas();
  // null = sem edição: mostra o que está gravado (ou o padrão). A primeira
  // alteração copia a lista para cá; salvar volta para null.
  const [edicao, setEdicao] = useState<Item[] | null>(null);
  const proximoId = useRef(0);
  const novoId = () => `r${proximoId.current++}`;

  const base: Item[] = respostas.map((r, i) => ({ ...r, _id: `s${i}` }));
  const itens = edicao ?? base;
  const alterado =
    edicao !== null &&
    JSON.stringify(edicao.map(({ titulo, texto }) => ({ titulo, texto }))) !==
      JSON.stringify(respostas.map(({ titulo, texto }) => ({ titulo, texto })));

  function alterar(fn: (lista: Item[]) => Item[]) {
    setEdicao((atual) => fn(atual ?? base));
  }

  function mudarCampo(id: string, campo: "titulo" | "texto", valor: string) {
    alterar((l) => l.map((it) => (it._id === id ? { ...it, [campo]: valor } : it)));
  }

  function mover(indice: number, passo: -1 | 1) {
    alterar((l) => {
      const destino = indice + passo;
      if (destino < 0 || destino >= l.length) return l;
      const nova = [...l];
      [nova[indice], nova[destino]] = [nova[destino]!, nova[indice]!];
      return nova;
    });
  }

  function remover(id: string) {
    alterar((l) => l.filter((it) => it._id !== id));
  }

  function adicionar() {
    alterar((l) => [...l, { _id: novoId(), titulo: "", texto: "" }]);
  }

  // Volta à lista padrão do código (vale depois de salvar).
  function usarPadrao() {
    setEdicao(RESPOSTAS_PADRAO.map((r) => ({ ...r, _id: novoId() })));
  }
  const ehPadrao =
    JSON.stringify(itens.map(({ titulo, texto }) => ({ titulo, texto }))) === JSON.stringify(RESPOSTAS_PADRAO);

  async function gravar() {
    const semTexto = itens.findIndex((it) => !it.texto.trim());
    if (semTexto >= 0) {
      toast.error(`Escreva o texto da resposta ${semTexto + 1} ou remova-a.`);
      return;
    }
    try {
      await salvar(itens.map(({ titulo, texto }) => ({ titulo: titulo.trim(), texto: texto.trim() })));
      setEdicao(null);
      toast.success("Respostas rápidas salvas");
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  // A gravação a RLS barra de qualquer forma; aqui só não mostra o que não dá para salvar.
  if (!podeGerenciar) return null;

  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-4">
        <div>
          <h2 className="text-title-md">Respostas rápidas do WhatsApp</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Mensagens prontas que a equipe insere no campo da conversa (botão ao lado do emoji ou{" "}
            <kbd className="rounded border bg-muted px-1 font-mono text-xs">/</kbd> no início do campo) e revisa
            antes de enviar. Use <code className="font-mono text-xs">{"{nome}"}</code> ou{" "}
            <code className="font-mono text-xs">{"{primeiro_nome}"}</code> para o nome do contato.
          </p>
          {!isLoading && !salvas && (
            <p className="text-xs text-muted-foreground mt-2">
              Ainda não há lista salva: abaixo está a lista padrão, que a equipe já vê. Edite e salve para trocar.
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : itens.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhuma resposta. Adicione a primeira.
          </p>
        ) : (
          <ol className="divide-y divide-divider">
            {itens.map((it, i) => (
              <li key={it._id} className="flex items-start gap-2 py-3 first:pt-0">
                <div className="flex flex-col gap-0.5 pt-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 toque:size-11"
                    onClick={() => mover(i, -1)}
                    disabled={i === 0}
                    aria-label={`Subir a resposta ${i + 1}`}
                    title="Subir"
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 toque:size-11"
                    onClick={() => mover(i, 1)}
                    disabled={i === itens.length - 1}
                    aria-label={`Descer a resposta ${i + 1}`}
                    title="Descer"
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Input
                    value={it.titulo}
                    onChange={(e) => mudarCampo(it._id, "titulo", e.target.value)}
                    placeholder="Título (ex.: Segue a guia)"
                    aria-label={`Título da resposta ${i + 1}`}
                    maxLength={60}
                  />
                  <Textarea
                    value={it.texto}
                    onChange={(e) => mudarCampo(it._id, "texto", e.target.value)}
                    placeholder="Texto que vai para o campo da conversa"
                    aria-label={`Texto da resposta ${i + 1}`}
                    maxLength={1000}
                    rows={2}
                    className="min-h-[64px]"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 toque:size-11 text-muted-foreground hover:text-destructive"
                  onClick={() => remover(it._id)}
                  aria-label={`Remover a resposta ${i + 1}`}
                  title="Remover"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ol>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={adicionar} disabled={isLoading}>
            <Plus />
            Adicionar resposta
          </Button>
          {salvas && !ehPadrao && (
            <Button type="button" variant="ghost" onClick={usarPadrao} disabled={pendente}>
              Usar a lista padrão
            </Button>
          )}
          <div className="flex-1" />
          {alterado && (
            <Button type="button" variant="ghost" onClick={() => setEdicao(null)} disabled={pendente}>
              Descartar
            </Button>
          )}
          <Button type="button" onClick={() => void gravar()} disabled={!alterado || pendente}>
            {pendente && <Loader2 className="animate-spin" />}
            Salvar
          </Button>
        </div>
        {alterado && (
          <p className="text-xs text-muted-foreground">
            {plural(itens.length, "resposta", "respostas")} na lista. As alterações só valem depois de salvar.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
