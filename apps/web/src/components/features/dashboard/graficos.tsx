import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useChartTokens } from "@/lib/chart-tokens";

// Gráficos da Visão geral. Um acento só (DESIGN.md): a série principal no
// --primary, a de comparação em cinza neutro (--muted-foreground). Grade e
// eixos recessivos, tooltip no hover, legenda quando há 2 séries.

function estiloTooltip(t: ReturnType<typeof useChartTokens>) {
  return {
    contentStyle: {
      background: t.popover,
      color: t.popoverFg,
      border: `1px solid ${t.border}`,
      borderRadius: 8,
      fontSize: 12,
      boxShadow: "var(--sombra-flutuante)",
    },
    labelStyle: { color: t.popoverFg, fontWeight: 600 },
    itemStyle: { color: t.popoverFg },
  };
}

const diaCurto = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

/** Mensagens recebidas x enviadas por dia (duas linhas, mesmo eixo). */
export function GraficoMensagens({ dados }: { dados: { dia: string; recebidas: number; enviadas: number }[] }) {
  const t = useChartTokens();
  const tt = estiloTooltip(t);
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legenda">
        <li className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: t.primary }} />
          Recebidas
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: t.muted }} />
          Enviadas
        </li>
      </ul>
      <div className="h-56" role="img" aria-label="Gráfico de mensagens recebidas e enviadas por dia">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dados} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke={t.border} />
            <XAxis
              dataKey="dia"
              tickFormatter={diaCurto}
              tick={{ fill: t.muted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={16}
            />
            <YAxis allowDecimals={false} tick={{ fill: t.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              {...tt}
              cursor={{ stroke: t.border, strokeWidth: 1 }}
              labelFormatter={(v) => diaCurto(String(v))}
            />
            <Line
              type="monotone"
              dataKey="recebidas"
              name="Recebidas"
              stroke={t.primary}
              strokeWidth={2}
              dot={dados.length <= 10 ? { r: 3, strokeWidth: 0, fill: t.primary } : false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: t.popover }}
            />
            <Line
              type="monotone"
              dataKey="enviadas"
              name="Enviadas"
              stroke={t.muted}
              strokeWidth={2}
              dot={dados.length <= 10 ? { r: 3, strokeWidth: 0, fill: t.muted } : false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: t.popover }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Barras horizontais de uma série (ranking), total rotulado na ponta. */
export function GraficoBarras({
  dados,
  rotulo,
  larguraNome = 140,
}: {
  dados: { nome: string; total: number }[];
  rotulo: string;
  larguraNome?: number;
}) {
  const t = useChartTokens();
  const tt = estiloTooltip(t);
  const linhas = dados.map((d) => ({
    ...d,
    curto: d.nome.length > 22 ? d.nome.slice(0, 21) + "…" : d.nome,
  }));
  const altura = Math.max(80, linhas.length * 32 + 8);
  return (
    <div style={{ height: altura }} role="img" aria-label={rotulo}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={linhas} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 0 }} barCategoryGap={6}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="curto"
            width={larguraNome}
            tick={{ fill: t.foreground, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            {...tt}
            cursor={{ fill: t.border, opacity: 0.35 }}
            labelFormatter={(_, p) => (p?.[0]?.payload as { nome?: string } | undefined)?.nome ?? ""}
            formatter={(v) => [String(v), "Total"]}
          />
          <Bar dataKey="total" fill={t.primary} radius={[0, 4, 4, 0]} maxBarSize={18}>
            <LabelList dataKey="total" position="right" fill={t.foreground} fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
