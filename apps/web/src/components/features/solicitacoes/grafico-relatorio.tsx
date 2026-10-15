import {
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
import type { LinhaRelatorio } from "@/lib/queries/solicitacoes";

/**
 * Ranking "mais pedidos": barras horizontais de UMA série (cor única, a do
 * primary), ordenadas do maior pro menor. Sem legenda (o título nomeia a
 * série); o total vai rotulado na ponta da barra e a tabela ao lado é a
 * visão acessível dos mesmos números.
 */
export function GraficoRelatorio({ linhas }: { linhas: LinhaRelatorio[] }) {
  const t = useChartTokens();
  const dados = linhas.slice(0, 12).map((l) => ({
    nome: l.nome.length > 28 ? l.nome.slice(0, 27) + "…" : l.nome,
    nomeCompleto: l.nome,
    total: l.total,
    abertas: l.abertas,
    concluidas: l.concluidas,
  }));
  const altura = Math.max(200, dados.length * 36 + 24);

  return (
    <div style={{ height: altura }} role="img" aria-label="Gráfico dos tipos de chamado mais pedidos">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 4 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke={t.border} strokeDasharray="0" />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fill: t.muted, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="nome"
            width={170}
            tick={{ fill: t.foreground, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: t.border, opacity: 0.35 }}
            contentStyle={{
              background: t.popover,
              color: t.popoverFg,
              border: `1px solid ${t.border}`,
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: t.popoverFg, fontWeight: 600 }}
            labelFormatter={(_, p) => (p?.[0]?.payload as { nomeCompleto?: string } | undefined)?.nomeCompleto ?? ""}
            formatter={(v, _n, item) => {
              const d = item?.payload as { abertas: number; concluidas: number } | undefined;
              return [`${v} (em aberto ${d?.abertas ?? 0} · concluídas ${d?.concluidas ?? 0})`, "Total"];
            }}
          />
          <Bar dataKey="total" fill={t.primary} radius={[0, 4, 4, 0]} maxBarSize={22}>
            <LabelList dataKey="total" position="right" fill={t.foreground} fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
