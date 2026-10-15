import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,

} from "recharts";

import { useChartTokens } from "@/lib/chart-tokens";

// Gráficos da Visão geral. Um acento só (DESIGN.md): a série principal no
// --primary, a de comparação em cinza neutro (--muted-foreground). Grade
// tracejada e recessiva, sem eixos desenhados, tooltip no tema do painel.

const diaCurto = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

const diaLongo = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" });

/** Tooltip no visual dos popovers: canvas, hairline, raio 11, sombra flutuante. */
type ItemDica = { dataKey?: unknown; name?: unknown; value?: unknown; color?: string };

function Dica({
  active,
  payload,
  label,
  titulo,
}: {
  active?: boolean;
  payload?: readonly ItemDica[];
  label?: unknown;
  titulo?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-pearl border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-flutuante min-w-32">
      <p className="font-semibold mb-1">{titulo ? titulo(String(label)) : String(label)}</p>
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            <span className="text-muted-foreground flex-1">{String(p.name)}</span>
            <span className="nums font-semibold">{String(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mensagens recebidas x enviadas por dia (duas áreas, mesmo eixo). */
export function GraficoMensagens({ dados }: { dados: { dia: string; recebidas: number; enviadas: number }[] }) {
  const t = useChartTokens();
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legenda">
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: t.primary }} />
          Recebidas
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: t.muted }} />
          Enviadas
        </li>
      </ul>
      <div className="h-60" role="img" aria-label="Gráfico de mensagens recebidas e enviadas por dia">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dados} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid vertical={false} stroke={t.border} strokeDasharray="3 4" />
            <XAxis
              dataKey="dia"
              tickFormatter={diaCurto}
              tick={{ fill: t.muted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={20}
              tickMargin={8}
            />
            <YAxis allowDecimals={false} tick={{ fill: t.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              content={<Dica titulo={diaLongo} />}
              cursor={{ stroke: t.muted, strokeWidth: 1, strokeDasharray: "3 3" }}
            />
            <Area
              type="monotone"
              dataKey="enviadas"
              name="Enviadas"
              stroke={t.muted}
              strokeWidth={1.5}
              fill={t.muted}
              fillOpacity={0.06}
              activeDot={{ r: 4, strokeWidth: 2, stroke: t.popover }}
            />
            <Area
              type="monotone"
              dataKey="recebidas"
              name="Recebidas"
              stroke={t.primary}
              strokeWidth={2}
              fill={t.primary}
              fillOpacity={0.1}
              activeDot={{ r: 4, strokeWidth: 2, stroke: t.popover }}
            />
          </AreaChart>
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
  const linhas = dados.map((d) => ({
    ...d,
    curto: d.nome.length > 22 ? d.nome.slice(0, 21) + "…" : d.nome,
  }));
  const altura = Math.max(80, linhas.length * 34 + 8);
  return (
    <div style={{ height: altura }} role="img" aria-label={rotulo}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={linhas} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 0 }} barCategoryGap={8}>
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
            content={<Dica titulo={(l) => linhas.find((x) => x.curto === l)?.nome ?? l} />}
            cursor={{ fill: t.border, opacity: 0.3, radius: 8 } as object}
          />
          <Bar
            dataKey="total"
            name="Total"
            fill={t.primary}
            radius={999}
            maxBarSize={14}
            background={{ fill: t.border, opacity: 0.35, radius: 999 } as object}
          >
            <LabelList dataKey="total" position="right" fill={t.foreground} fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
