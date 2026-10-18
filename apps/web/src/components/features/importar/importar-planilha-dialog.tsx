import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { msgErro } from "@/lib/erro";
import { formatDoc } from "@/lib/format";
import {
  adivinharMapa,
  aplicarMapa,
  type Aba,
  baixarModelo,
  CAMPOS_CERTIFICADO,
  CAMPOS_CLIENTE,
  CAMPOS_SOCIO,
  type Campo,
  type ClienteExistente,
  criarAchador,
  lerArquivo,
  type LinhaCertificado,
  type LinhaCliente,
  type LinhaSocio,
  type Mapa,
  melhorAba,
  validarCertificados,
  validarClientes,
  validarSocios,
} from "@/lib/importar-planilha";
import { supabase } from "@/lib/supabase";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/texto";

type Alvo = "clientes" | "certificados";
type Etapa = "arquivo" | "mapa" | "previa" | "importando" | "fim";

type Previa = {
  clientes: LinhaCliente[];
  socios: LinhaSocio[];
  certificados: LinhaCertificado[];
};

type Resumo = { criados: number; atualizados: number; socios: number; certificados: number; pulados: number; falhas: string[] };

const NAO_USAR = -1;

async function carregarClientes(): Promise<ClienteExistente[]> {
  const out: ClienteExistente[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from("Cliente").select("id, nome, nomeFantasia, cpfCnpj, tipo, provisorio, telefoneNormalizado").order("id").range(de, de + 999);
    if (error) throw error;
    out.push(...((data ?? []) as ClienteExistente[]));
    if (!data || data.length < 1000) return out;
  }
}

/** Seletor de coluna para um campo. */
function SeletorColuna({ campo, aba, valor, onChange }: { campo: Campo; aba: Aba; valor: number; onChange: (v: number) => void }) {
  const amostra = valor >= 0 ? aba.linhas.find((l) => l[valor])?.[valor] : undefined;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 py-1.5">
      <Label className="text-xs">
        {campo.rotulo}
        {campo.obrigatorio && <span className="text-destructive"> *</span>}
      </Label>
      <div className="min-w-0">
        <select
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          value={valor}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`Coluna para ${campo.rotulo}`}
        >
          <option value={NAO_USAR}>(não importar)</option>
          {aba.cabecalho.map((h, i) => (
            <option key={i} value={i}>
              {h || `Coluna ${i + 1}`}
            </option>
          ))}
        </select>
        {amostra && <p className="truncate text-2xs text-muted-foreground mt-0.5">ex.: {amostra}</p>}
      </div>
    </div>
  );
}

function BlocoMapa({
  titulo,
  abas,
  abaIdx,
  setAbaIdx,
  campos,
  mapa,
  setMapa,
  opcional,
}: {
  titulo: string;
  abas: Aba[];
  abaIdx: number;
  setAbaIdx: (i: number) => void;
  campos: Campo[];
  mapa: Mapa;
  setMapa: (m: Mapa) => void;
  opcional?: boolean;
}) {
  const aba = abaIdx >= 0 ? abas[abaIdx] : undefined;
  // Primeiro só o que importa: obrigatórios e campos que já casaram com uma coluna.
  const [todos, setTodos] = useState(false);
  const usados = campos.filter((c) => c.obrigatorio || (mapa[c.campo] ?? NAO_USAR) !== NAO_USAR);
  const visiveis = todos ? campos : usados;
  const escondidos = campos.length - usados.length;
  return (
    <section className="rounded-card border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold flex-1">{titulo}</h3>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={abaIdx}
          aria-label={`Aba de ${titulo}`}
          onChange={(e) => {
            const i = Number(e.target.value);
            setAbaIdx(i);
            if (i >= 0) setMapa(adivinharMapa(abas[i]!.cabecalho, campos));
          }}
        >
          {opcional && <option value={-1}>(não importar)</option>}
          {abas.map((a, i) => (
            <option key={i} value={i}>
              Aba {a.nome} ({plural(a.linhas.length, "linha", "linhas")})
            </option>
          ))}
        </select>
      </div>
      {aba && (
        <>
          <div className="divide-y divide-divider">
            {visiveis.map((c) => (
              <SeletorColuna key={c.campo} campo={c} aba={aba} valor={mapa[c.campo] ?? NAO_USAR} onChange={(v) => setMapa({ ...mapa, [c.campo]: v })} />
            ))}
          </div>
          {escondidos > 0 || todos ? (
            <button type="button" onClick={() => setTodos((v) => !v)} className="text-xs font-semibold text-primary hover:underline">
              {todos ? "Mostrar só os campos usados" : `Mostrar todos os campos (mais ${escondidos})`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function TabelaPrevia<T extends { linha: number; erros: string[] }>({
  titulo,
  linhas,
  colunas,
  status,
}: {
  titulo: string;
  linhas: T[];
  colunas: Array<[string, (l: T) => string]>;
  status: (l: T) => { texto: string; tom: "success" | "warning" | "destructive" | "secondary" };
}) {
  const [soErros, setSoErros] = useState(false);
  const erros = linhas.filter((l) => l.erros.length).length;
  const vis = (soErros ? linhas.filter((l) => l.erros.length) : linhas).slice(0, 300);
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold flex-1">
          {titulo} <span className="text-muted-foreground font-normal">· {plural(linhas.length, "linha", "linhas")}{erros ? `, ${erros} com erro` : ""}</span>
        </h3>
        {erros > 0 && (
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={soErros} onChange={(e) => setSoErros(e.target.checked)} />
            Só com erro
          </label>
        )}
      </div>
      <div className="max-h-72 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Linha</th>
              {colunas.map(([r]) => (
                <th key={r} className="px-2 py-1.5 text-left font-medium">
                  {r}
                </th>
              ))}
              <th className="px-2 py-1.5 text-left font-medium">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {vis.map((l) => {
              const st = status(l);
              return (
                <tr key={l.linha} className={cn(l.erros.length > 0 && "bg-destructive/5")}>
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{l.linha}</td>
                  {colunas.map(([r, f]) => (
                    <td key={r} className="px-2 py-1.5 max-w-[14rem] truncate">
                      {f(l)}
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <Badge variant={st.tom}>{st.texto}</Badge>
                    {l.erros.length > 0 && <p className="mt-0.5 text-2xs text-destructive">{l.erros.join(" · ")}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {linhas.length > vis.length && <p className="text-2xs text-muted-foreground">Mostrando {vis.length} de {linhas.length}.</p>}
    </section>
  );
}

const semVazios = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Partial<T>;

export function ImportarPlanilhaDialog({ alvo, open, onOpenChange }: { alvo: Alvo; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [etapa, setEtapa] = useState<Etapa>("arquivo");
  const [arquivo, setArquivo] = useState<string>("");
  const [abas, setAbas] = useState<Aba[]>([]);
  const [abaPrincipal, setAbaPrincipal] = useState(0);
  const [mapaPrincipal, setMapaPrincipal] = useState<Mapa>({});
  const [abaSocios, setAbaSocios] = useState(-1);
  const [mapaSocios, setMapaSocios] = useState<Mapa>({});
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [progresso, setProgresso] = useState({ feito: 0, total: 0 });
  const [resumo, setResumo] = useState<Resumo | null>(null);

  const camposPrincipais = alvo === "clientes" ? CAMPOS_CLIENTE : CAMPOS_CERTIFICADO;

  function reiniciar() {
    setEtapa("arquivo");
    setArquivo("");
    setAbas([]);
    setPrevia(null);
    setResumo(null);
  }

  async function escolher(f: File | undefined) {
    if (!f) return;
    if (!/\.(xlsx|xls|csv|txt|ods)$/i.test(f.name)) {
      toast.error("Envie uma planilha .xlsx, .xls, .ods ou .csv.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("Arquivo grande demais (máximo 10 MB).");
      return;
    }
    setCarregando(true);
    try {
      const lidas = (await lerArquivo(f)).filter((a) => a.cabecalho.length > 0);
      if (lidas.length === 0) throw new Error("A planilha está vazia.");
      setArquivo(f.name);
      setAbas(lidas);
      const ip = Math.max(0, melhorAba(lidas, camposPrincipais, alvo === "clientes" ? "Clientes" : "Certificados"));
      setAbaPrincipal(ip);
      setMapaPrincipal(adivinharMapa(lidas[ip]!.cabecalho, camposPrincipais));
      if (alvo === "clientes") {
        const is = lidas.findIndex((a, i) => i !== ip && /^s[oó]cio/i.test(a.nome));
        setAbaSocios(is);
        if (is >= 0) setMapaSocios(adivinharMapa(lidas[is]!.cabecalho, CAMPOS_SOCIO));
      }
      setEtapa("mapa");
    } catch (e) {
      toast.error("Não foi possível ler a planilha: " + msgErro(e));
    } finally {
      setCarregando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const faltaObrigatorio = useMemo(() => {
    const f = camposPrincipais.filter((c) => c.obrigatorio && (mapaPrincipal[c.campo] ?? -1) < 0).map((c) => c.rotulo);
    if (alvo === "clientes" && abaSocios >= 0) {
      f.push(...CAMPOS_SOCIO.filter((c) => c.obrigatorio && (mapaSocios[c.campo] ?? -1) < 0).map((c) => `Sócios: ${c.rotulo}`));
    }
    return f;
  }, [camposPrincipais, mapaPrincipal, mapaSocios, abaSocios, alvo]);

  async function montarPrevia() {
    setCarregando(true);
    try {
      const existentes = await carregarClientes();
      const linhas = aplicarMapa(abas[abaPrincipal]!, mapaPrincipal);
      if (alvo === "clientes") {
        const clientes = validarClientes(linhas, existentes);
        const socios = abaSocios >= 0 ? validarSocios(aplicarMapa(abas[abaSocios]!, mapaSocios), criarAchador(existentes, clientes)) : [];
        setPrevia({ clientes, socios, certificados: [] });
      } else {
        const { data, error } = await supabase.from("CertificadoDigital").select("clienteId, tipo, validoAte").limit(20000);
        if (error) throw error;
        setPrevia({ clientes: [], socios: [], certificados: validarCertificados(linhas, existentes, data ?? []) });
      }
      setEtapa("previa");
    } catch (e) {
      toast.error("Não foi possível montar a prévia: " + msgErro(e));
    } finally {
      setCarregando(false);
    }
  }

  async function importar() {
    if (!previa) return;
    setEtapa("importando");
    const r: Resumo = { criados: 0, atualizados: 0, socios: 0, certificados: 0, pulados: 0, falhas: [] };
    try {
      if (alvo === "clientes") {
        const validos = previa.clientes.filter((c) => c.dados && c.erros.length === 0);
        r.pulados += previa.clientes.length - validos.length;
        const sociosValidos = previa.socios.filter((s) => s.dados);
        r.pulados += previa.socios.length - sociosValidos.length;
        setProgresso({ feito: 0, total: validos.length + sociosValidos.length });
        const docParaId = new Map<string, string>();
        const novos = validos.filter((c) => c.acao === "criar");
        for (let i = 0; i < novos.length; i += 100) {
          const lote = novos.slice(i, i + 100);
          const { data, error } = await supabase.from("Cliente").insert(lote.map((c) => c.dados!)).select("id, cpfCnpj");
          if (error) {
            r.falhas.push(`Linhas ${lote[0]!.linha}–${lote[lote.length - 1]!.linha}: ${msgErro(error)}`);
          } else {
            r.criados += data?.length ?? 0;
            for (const d of data ?? []) if (d.cpfCnpj) docParaId.set(d.cpfCnpj as string, d.id as string);
          }
          setProgresso((p) => ({ ...p, feito: p.feito + lote.length }));
        }
        for (const c of validos.filter((x) => x.acao === "atualizar")) {
          // Atualiza só o que veio preenchido: célula vazia não apaga o cadastro.
          // Provisório (criado pelo WhatsApp como PF) leva também o tipo da
          // planilha; com e-mail ou CPF/CNPJ, o gatilho tira o "provisório".
          const { tipo, ativo: _a, ...resto } = c.dados!;
          void _a;
          const patch = c.completaProvisorio ? { ...semVazios(resto), tipo } : semVazios(resto);
          const { error } = await supabase.from("Cliente").update(patch).eq("id", c.existenteId!);
          if (error) r.falhas.push(`Linha ${c.linha}: ${msgErro(error)}`);
          else r.atualizados++;
          setProgresso((p) => ({ ...p, feito: p.feito + 1 }));
        }
        if (sociosValidos.length) {
          const ids = new Set<string>();
          for (const s of sociosValidos) {
            const id = s.clienteId ?? (s.clienteDocNovo ? docParaId.get(s.clienteDocNovo) : undefined);
            if (id) ids.add(id);
          }
          const { data: ja } = await supabase.from("Socio").select("clienteId, nome, cpf").in("clienteId", [...ids].slice(0, 1000));
          const chave = (cli: string, nome: string, cpf: string | null) => (cpf ? `${cli}|${cpf}` : `${cli}|n:${nome.toLowerCase()}`);
          const existe = new Set((ja ?? []).map((s) => chave(s.clienteId as string, s.nome as string, s.cpf as string | null)));
          const inserir = [];
          for (const s of sociosValidos) {
            const id = s.clienteId ?? (s.clienteDocNovo ? docParaId.get(s.clienteDocNovo) : undefined);
            if (!id) {
              r.falhas.push(`Sócio na linha ${s.linha}: o cliente não foi criado`);
              continue;
            }
            const k = chave(id, s.dados!.nome, s.dados!.cpf);
            if (existe.has(k)) {
              r.pulados++;
              continue;
            }
            existe.add(k);
            inserir.push({ ...s.dados!, clienteId: id });
          }
          for (let i = 0; i < inserir.length; i += 100) {
            const lote = inserir.slice(i, i + 100);
            const { error } = await supabase.from("Socio").insert(lote);
            if (error) r.falhas.push(`Sócios: ${msgErro(error)}`);
            else r.socios += lote.length;
          }
          setProgresso((p) => ({ ...p, feito: p.total }));
        }
        qc.invalidateQueries({ queryKey: ["clientes"] });
        qc.invalidateQueries({ queryKey: ["socios"] });
        qc.invalidateQueries({ queryKey: ["aniversarios"] });
      } else {
        const validos = previa.certificados.filter((c) => c.dados && !c.repetido);
        r.pulados = previa.certificados.length - validos.length;
        setProgresso({ feito: 0, total: validos.length });
        for (let i = 0; i < validos.length; i += 100) {
          const lote = validos.slice(i, i + 100);
          const { error } = await supabase
            .from("CertificadoDigital")
            .insert(lote.map((c) => ({ ...c.dados!, clienteId: c.clienteId!, avisarWhatsapp: true })));
          if (error) r.falhas.push(`Linhas ${lote[0]!.linha}–${lote[lote.length - 1]!.linha}: ${msgErro(error)}`);
          else r.certificados += lote.length;
          setProgresso((p) => ({ ...p, feito: p.feito + lote.length }));
        }
        qc.invalidateQueries({ queryKey: ["certificados"] });
      }
    } catch (e) {
      r.falhas.push(msgErro(e));
    }
    setResumo(r);
    setEtapa("fim");
  }

  const contagem = useMemo(() => {
    if (!previa) return null;
    if (alvo === "clientes") {
      return {
        ok: previa.clientes.filter((c) => c.dados && !c.erros.length).length + previa.socios.filter((s) => s.dados).length,
        erro: previa.clientes.filter((c) => c.erros.length).length + previa.socios.filter((s) => s.erros.length).length,
        texto: `${plural(previa.clientes.filter((c) => c.acao === "criar" && !c.erros.length).length, "novo", "novos")}, ${previa.clientes.filter((c) => c.acao === "atualizar" && !c.erros.length).length} a atualizar${previa.socios.length ? `, ${plural(previa.socios.filter((s) => s.dados).length, "sócio", "sócios")}` : ""}`,
      };
    }
    return {
      ok: previa.certificados.filter((c) => c.dados && !c.repetido).length,
      erro: previa.certificados.filter((c) => c.erros.length).length,
      texto: `${plural(previa.certificados.filter((c) => c.dados && !c.repetido).length, "certificado novo", "certificados novos")}, ${plural(previa.certificados.filter((c) => c.repetido).length, "já cadastrado", "já cadastrados")}`,
    };
  }, [previa, alvo]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (etapa === "importando") return;
        if (!o) reiniciar();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar planilha de {alvo === "clientes" ? "clientes" : "certificados"}</DialogTitle>
          <DialogDescription>
            {etapa === "arquivo" && "Envie um arquivo .xlsx ou .csv. Na próxima etapa você confere qual coluna é qual."}
            {etapa === "mapa" && `${arquivo}: confira as colunas. Adivinhamos pelo nome do cabeçalho.`}
            {etapa === "previa" && "Confira antes de gravar. Linhas com erro ficam de fora e não impedem as outras."}
            {etapa === "importando" && "Gravando… não feche esta janela."}
            {etapa === "fim" && "Importação concluída."}
          </DialogDescription>
        </DialogHeader>

        {etapa === "arquivo" && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void escolher(e.dataTransfer.files?.[0]);
              }}
              className="w-full rounded-card border-2 border-dashed p-8 text-center hover:bg-accent/40"
              disabled={carregando}
            >
              {carregando ? <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" /> : <FileSpreadsheet className="mx-auto size-8 text-muted-foreground" />}
              <p className="mt-2 text-sm font-medium">Clique ou arraste a planilha aqui</p>
              <p className="text-xs text-muted-foreground">
                {alvo === "clientes"
                  ? "Uma aba de clientes e, se quiser, uma aba de sócios. Cliente com o mesmo CPF/CNPJ é atualizado; cadastro provisório do WhatsApp com o mesmo telefone é completado."
                  : "Cliente pelo CPF/CNPJ (ou nome exato), tipo, validade, titular, emissora e telefone para aviso."}
              </p>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.ods,.csv,.txt"
              className="hidden"
              onChange={(e) => void escolher(e.target.files?.[0])}
            />
            <Button variant="outline" size="sm" onClick={() => void baixarModelo(alvo)}>
              <Download />
              Baixar planilha modelo
            </Button>
          </div>
        )}

        {etapa === "mapa" && (
          <div className="space-y-3">
            <BlocoMapa
              titulo={alvo === "clientes" ? "Clientes" : "Certificados"}
              abas={abas}
              abaIdx={abaPrincipal}
              setAbaIdx={setAbaPrincipal}
              campos={camposPrincipais}
              mapa={mapaPrincipal}
              setMapa={setMapaPrincipal}
            />
            {alvo === "clientes" && (
              <BlocoMapa titulo="Sócios (opcional)" abas={abas} abaIdx={abaSocios} setAbaIdx={setAbaSocios} campos={CAMPOS_SOCIO} mapa={mapaSocios} setMapa={setMapaSocios} opcional />
            )}
            {faltaObrigatorio.length > 0 && <p className="text-xs text-destructive">Escolha a coluna de: {faltaObrigatorio.join(", ")}.</p>}
          </div>
        )}

        {etapa === "previa" && previa && (
          <div className="space-y-4">
            {alvo === "clientes" ? (
              <>
                <TabelaPrevia
                  titulo="Clientes"
                  linhas={previa.clientes}
                  colunas={[["Nome", (l) => (l.dados?.nomeFantasia?.trim() && l.dados.nomeFantasia.trim() !== l.nome ? `${l.dados.nomeFantasia.trim()} (${l.nome})` : l.nome)], ["CPF/CNPJ", (l) => (l.doc ? formatDoc(l.doc) : "")]]}
                  status={(l) =>
                    l.erros.length
                      ? { texto: "Erro", tom: "destructive" }
                      : l.completaProvisorio
                        ? { texto: "Completar provisório", tom: "warning" }
                        : l.acao === "atualizar"
                          ? { texto: "Atualizar", tom: "warning" }
                          : { texto: "Novo", tom: "success" }
                  }
                />
                {previa.socios.length > 0 && (
                  <TabelaPrevia
                    titulo="Sócios"
                    linhas={previa.socios}
                    colunas={[["Sócio", (l) => l.nome], ["Empresa", (l) => l.clienteNome ?? l.clienteBusca]]}
                    status={(l) => (l.erros.length ? { texto: "Erro", tom: "destructive" } : { texto: "Novo", tom: "success" })}
                  />
                )}
              </>
            ) : (
              <TabelaPrevia
                titulo="Certificados"
                linhas={previa.certificados}
                colunas={[["Cliente", (l) => l.clienteNome ?? l.clienteBusca], ["Tipo", (l) => l.dados?.tipo ?? ""], ["Válido até", (l) => l.dados?.validoAte.split("-").reverse().join("/") ?? ""]]}
                status={(l) =>
                  l.erros.length ? { texto: "Erro", tom: "destructive" } : l.repetido ? { texto: "Já existe", tom: "secondary" } : { texto: "Novo", tom: "success" }
                }
              />
            )}
            {contagem && <p className="text-sm">Vai gravar: <strong>{contagem.texto}</strong>{contagem.erro ? ` · ${plural(contagem.erro, "linha com erro fica", "linhas com erro ficam")} de fora` : ""}.</p>}
          </div>
        )}

        {etapa === "importando" && (
          <div className="space-y-2 py-6 text-center">
            <Loader2 className="mx-auto size-8 animate-spin text-primary" />
            <p className="text-sm tabular-nums">
              {progresso.feito} de {progresso.total}
            </p>
          </div>
        )}

        {etapa === "fim" && resumo && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="size-5" />
              <p className="text-sm font-medium">
                {alvo === "clientes"
                  ? `${plural(resumo.criados, "cliente criado", "clientes criados")}, ${plural(resumo.atualizados, "atualizado", "atualizados")}, ${plural(resumo.socios, "sócio", "sócios")}.`
                  : `${plural(resumo.certificados, "certificado cadastrado", "certificados cadastrados")}.`}
              </p>
            </div>
            {resumo.pulados > 0 && <p className="text-xs text-muted-foreground">{plural(resumo.pulados, "linha ficou", "linhas ficaram")} de fora (erro ou já cadastradas).</p>}
            {resumo.falhas.length > 0 && (
              <ul className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive list-disc pl-6">
                {resumo.falhas.slice(0, 20).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          {etapa === "mapa" && (
            <>
              <Button variant="ghost" onClick={reiniciar}>
                Outro arquivo
              </Button>
              <Button onClick={() => void montarPrevia()} disabled={faltaObrigatorio.length > 0 || carregando}>
                {carregando && <Loader2 className="animate-spin" />}
                Ver prévia
              </Button>
            </>
          )}
          {etapa === "previa" && (
            <>
              <Button variant="ghost" onClick={() => setEtapa("mapa")}>
                Voltar
              </Button>
              <Button onClick={() => void importar()} disabled={!contagem?.ok}>
                <Upload />
                Importar {plural(contagem?.ok ?? 0, "linha", "linhas")}
              </Button>
            </>
          )}
          {etapa === "fim" && (
            <Button
              onClick={() => {
                reiniciar();
                onOpenChange(false);
              }}
            >
              Concluir
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Botão do cabeçalho "Importar planilha". */
export function ImportarPlanilhaBotao({ alvo }: { alvo: Alvo }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setAberto(true)}>
        <FileSpreadsheet />
        Importar planilha
      </Button>
      <ImportarPlanilhaDialog alvo={alvo} open={aberto} onOpenChange={setAberto} />
    </>
  );
}
