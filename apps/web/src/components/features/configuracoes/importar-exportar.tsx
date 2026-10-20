import { BadgeCheck, ClipboardList, Download, FileDown, Loader2, Package, Users } from "lucide-react";
import { useState, type ComponentType, type ReactNode } from "react";

import { ImportarPlanilhaBotao } from "@/components/features/importar/importar-planilha-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePermissao } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import type { Exportacao } from "@/lib/exportar";
import { baixarModelo } from "@/lib/importar-planilha";
import { useModulos } from "@/lib/modulos";
import { toast } from "@/lib/toast";

/**
 * Configurações > Importar e exportar: tudo num lugar só. A exportação sai no
 * MESMO formato da importação (lib/exportar.ts), então o caminho é exportar →
 * corrigir no Excel → importar de volta. Cada bloco aparece só com o módulo
 * ligado e a permissão do cargo (o banco confere de novo pela RLS).
 */
export function ConfigImportarExportar() {
  const { ativo } = useModulos();
  const verClientes = usePermissao("clientes.ver") && ativo("clientes");
  const editarClientes = usePermissao("clientes.editar") && ativo("clientes");
  const verCertificados = usePermissao("certificados.ver") && ativo("certificados");
  const editarCertificados = usePermissao("certificados.editar") && ativo("certificados");
  const verChamados = usePermissao("chamados.ver") && ativo("chamados");
  const tudo: Exportacao[] = [
    ...(verClientes ? (["clientes"] as const) : []),
    ...(verCertificados ? (["certificados"] as const) : []),
    ...(verChamados ? (["chamados"] as const) : []),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <div className="flex flex-wrap items-start gap-3">
            <Package className="size-5 mt-0.5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-[16rem]">
              <h2 className="text-title-md">Tudo numa planilha</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Um arquivo Excel com uma aba para cada coisa (clientes, sócios, certificados e chamados). Serve de cópia
                para guardar, para mandar ao contador ou para corrigir em lote e importar de volta.
              </p>
            </div>
            <BotaoExportar incluir={tudo} rotulo="Exportar tudo" principal disabled={tudo.length === 0} />
          </div>
          <ol className="list-decimal pl-5 space-y-1 text-xs text-muted-foreground">
            <li>Exporte. As colunas têm os mesmos nomes da planilha de importação.</li>
            <li>Corrija ou complete no Excel (ou no Google Planilhas). Célula apagada não apaga o dado no painel.</li>
            <li>
              Importe o mesmo arquivo no bloco abaixo: o painel mostra o que vai criar e o que vai atualizar antes de
              gravar.
            </li>
          </ol>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {verClientes && (
          <Bloco
            icone={Users}
            titulo="Clientes e sócios"
            texto="Cliente é achado pelo CPF/CNPJ e o sócio pelo CPF (ou nome) dentro da empresa. Quem não existe é criado; quem existe é atualizado."
          >
            <BotaoExportar incluir={["clientes"]} rotulo="Exportar" />
            {editarClientes && (
              <>
                <ImportarPlanilhaBotao alvo="clientes" />
                <BotaoModelo alvo="clientes" />
              </>
            )}
          </Bloco>
        )}
        {verCertificados && (
          <Bloco
            icone={BadgeCheck}
            titulo="Certificados digitais"
            texto="Certificado é achado por cliente + tipo + validade. Os clientes precisam estar cadastrados antes (importe os clientes primeiro)."
          >
            <BotaoExportar incluir={["certificados"]} rotulo="Exportar" />
            {editarCertificados && (
              <>
                <ImportarPlanilhaBotao alvo="certificados" />
                <BotaoModelo alvo="certificados" />
              </>
            )}
          </Bloco>
        )}
        {verChamados && (
          <Bloco
            icone={ClipboardList}
            titulo="Chamados"
            texto="Todos os chamados, com cliente, tipo, status, responsável, prazo e descrição. Só exportação, para relatório."
          >
            <BotaoExportar incluir={["chamados"]} rotulo="Exportar" />
          </Bloco>
        )}
      </div>
    </div>
  );
}

function Bloco({
  icone: Icone,
  titulo,
  texto,
  children,
}: {
  icone: ComponentType<{ className?: string }>;
  titulo: string;
  texto: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-3">
        <div className="flex items-start gap-3">
          <Icone className="size-5 mt-0.5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h3 className="text-title-md">{titulo}</h3>
            <p className="text-sm text-muted-foreground mt-1">{texto}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">{children}</div>
      </CardContent>
    </Card>
  );
}

/** Botão que baixa o .xlsx (também usado na tela de Certificados). */
export function BotaoExportar({
  incluir,
  rotulo,
  principal,
  disabled,
}: {
  incluir: Exportacao[];
  rotulo: string;
  principal?: boolean;
  disabled?: boolean;
}) {
  const [exportando, setExportando] = useState(false);
  async function exportar() {
    setExportando(true);
    try {
      const { exportar } = await import("@/lib/exportar");
      const contagem = await exportar({ incluir });
      const partes = Object.entries(contagem).map(([aba, n]) => `${aba}: ${n.toLocaleString("pt-BR")}`);
      const total = Object.values(contagem).reduce((a, b) => a + b, 0);
      if (total === 0) toast.info("Planilha baixada, mas ainda não há registros");
      else toast.success(`Planilha baixada (${partes.join(", ")})`);
    } catch (e) {
      toast.error("Não foi possível exportar: " + msgErro(e));
    } finally {
      setExportando(false);
    }
  }
  return (
    <Button variant={principal ? "default" : "outline"} onClick={() => void exportar()} disabled={exportando || disabled}>
      {exportando ? <Loader2 className="animate-spin" /> : <Download />}
      {rotulo}
    </Button>
  );
}

function BotaoModelo({ alvo }: { alvo: "clientes" | "certificados" }) {
  return (
    <Button
      variant="ghost"
      onClick={() =>
        void baixarModelo(alvo).catch((e) => toast.error("Não foi possível baixar o modelo: " + msgErro(e)))
      }
      title="Planilha vazia com as colunas, a explicação de cada uma e um exemplo"
    >
      <FileDown />
      Planilha modelo
    </Button>
  );
}
