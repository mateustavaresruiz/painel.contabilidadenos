import { ArrowRight, ImageUp, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { msgErro } from "@/lib/erro";
import { useMarca, useModulos, useSalvarLogo, useSalvarNomeEscritorio } from "@/lib/modulos";
import { toast } from "@/lib/toast";

export function ConfigGeral() {
  const { data: marca, isLoading } = useMarca();
  const salvarNome = useSalvarNomeEscritorio();
  const salvarLogo = useSalvarLogo();
  const { ativo } = useModulos();
  const [nome, setNome] = useState("");
  const arquivoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (marca) setNome(marca.nome);
  }, [marca]);

  async function gravarNome(e: React.FormEvent) {
    e.preventDefault();
    if (nome.trim().length < 2) {
      toast.error("Informe o nome do escritório.");
      return;
    }
    try {
      await salvarNome.mutateAsync(nome);
      toast.success("Nome salvo.");
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  async function enviarLogo(arquivo: File | null) {
    try {
      await salvarLogo.mutateAsync(arquivo);
      toast.success(arquivo ? "Logo atualizada." : "Voltou para a logo NÓS.");
    } catch (err) {
      toast.error(msgErro(err));
    } finally {
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6 space-y-4">
          <div>
            <h2 className="text-title-md">Escritório</h2>
            <p className="text-sm text-muted-foreground mt-1">Nome que aparece no menu e nos relatórios.</p>
          </div>
          <form onSubmit={gravarNome} className="flex flex-col gap-2 sm:flex-row sm:items-end max-w-xl">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="cfg-nome">Nome do escritório</Label>
              <Input id="cfg-nome" value={nome} onChange={(e) => setNome(e.target.value)} disabled={isLoading} />
            </div>
            <Button type="submit" disabled={salvarNome.isPending || isLoading || nome.trim() === marca?.nome}>
              {salvarNome.isPending && <Loader2 className="animate-spin" />}
              Salvar
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div>
            <h2 className="text-title-md">Logo</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Opcional. PNG, JPG, WEBP ou SVG até 2 MB, de preferência com fundo transparente. Sem logo
              própria, o painel usa a da NÓS.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="h-16 min-w-40 rounded-md border bg-background px-4 grid place-items-center">
              <Logo className="h-11" />
            </div>
            <input
              ref={arquivoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => void enviarLogo(e.target.files?.[0] ?? null).then(() => undefined)}
            />
            <Button variant="outline" onClick={() => arquivoRef.current?.click()} disabled={salvarLogo.isPending}>
              {salvarLogo.isPending ? <Loader2 className="animate-spin" /> : <ImageUp />}
              Enviar logo
            </Button>
            {marca?.logoPath && (
              <Button variant="ghost" onClick={() => void enviarLogo(null)} disabled={salvarLogo.isPending}>
                <Trash2 />
                Usar a logo NÓS
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-3">
          <div>
            <h2 className="text-title-md">Ajustes dos módulos</h2>
            <p className="text-sm text-muted-foreground mt-1">Ficam na página de cada módulo.</p>
          </div>
          <ul className="divide-y divide-divider">
            {ativo("certificados") && (
              <LinkAjuste
                to="/certificados"
                titulo="Avisos de certificado"
                texto="Marcos de vencimento, número que envia e modelo da mensagem (fim da página Certificados)."
              />
            )}
            {ativo("chamados") && (
              <LinkAjuste
                to="/chamados?aba=tipos"
                titulo="Tipos de chamado"
                texto="Quais tipos aparecem no botão Abrir chamado e em que ordem."
              />
            )}
            {ativo("equipe") && (
              <LinkAjuste to="/equipe" titulo="Equipe e papéis" texto="Quem atende e quem é administrador." />
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function LinkAjuste({ to, titulo, texto }: { to: string; titulo: string; texto: string }) {
  return (
    <li>
      <Link to={to} className="group flex items-center gap-3 py-3 hover:text-primary">
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold">{titulo}</span>
          <span className="block text-xs text-muted-foreground">{texto}</span>
        </span>
        <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary" />
      </Link>
    </li>
  );
}
