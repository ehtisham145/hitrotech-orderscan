// Business KPI charts — each chart uses a distinct visualization type.
import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { useWorkspace } from "@/components/WorkspaceContext";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer, ComposedChart, Area, Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell, LabelList, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  Treemap, ScatterChart, Scatter, ZAxis, Legend, PieChart, Pie, RadialBarChart, RadialBar,
  FunnelChart, Funnel,
} from "recharts";
import { NEON_CARD, NEON_TOOLTIP, NEON_TOOLTIP_ITEM, NEON_TOOLTIP_LABEL, brandColorFor } from "@/components/dashboard/chart-theme";
import { IsoPie3D, Ring3DSteps, CalendarHeatmap, PaceGauge } from "@/components/dashboard/FancyCharts";
import { getBusinessTrends } from "@/lib/trends.functions";
import { usePlanFeatures } from "@/lib/use-plan-features";


const ROLE_LABEL: Record<string, string> = {
  franchise_owner: "Franchise",
  retailer: "Retailer",
  franchise_as_retailer: "Franchise-Retail",
  field_worker: "Field",
  asm: "ASM",
  unassigned: "Unassigned",
};

const pkr = (n: number) => "PKR " + (n ?? 0).toLocaleString();

// Distinct hue family per chart so no two charts read alike.
const C = {
  pace: "#6366f1",
  paceAlt: "#22d3ee",
  momentum: "#a855f7",
  momentumAlt: "#ec4899",
  mix: "#f97316",
  stores: ["#0ea5e9", "#22c55e", "#eab308", "#f43f5e", "#a855f7", "#14b8a6", "#f97316", "#6366f1", "#ec4899", "#84cc16", "#06b6d4", "#8b5cf6"],
  scatter: "#22c55e",
};

// Every panel is the same height so the grid always reads as clean, aligned rows.
const PANEL_BODY_HEIGHT = 290;

function Panel({ title, subtitle, children, raw = false }: { title: string; subtitle?: string; children: React.ReactNode; height?: number; raw?: boolean }) {
  return (
    <Card className={NEON_CARD + " rounded-xl border-slate-200/60 shadow-sm h-full flex flex-col overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-md"}>
      <CardHeader className="pb-1">
        <CardTitle className="text-base font-semibold text-foreground">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 min-h-[2rem]">{subtitle}</p>}
      </CardHeader>
      <CardContent className="relative pt-2 flex-1" style={{ height: PANEL_BODY_HEIGHT }}>
        {raw ? (
          children
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}


const tip = {
  contentStyle: NEON_TOOLTIP as React.CSSProperties,
  itemStyle: NEON_TOOLTIP_ITEM as React.CSSProperties,
  labelStyle: NEON_TOOLTIP_LABEL as React.CSSProperties,
};

export function BusinessKpiCharts() {
  const { workspace } = useWorkspace();
  const fetchTrends = useServerFn(getBusinessTrends);
  const { data, isLoading } = useQuery({
    queryKey: ["business-trends", workspace?.id],
    queryFn: () => fetchTrends({ data: { workspaceId: workspace?.id } }),
    staleTime: 60_000,
    enabled: !!workspace?.id,
  });

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-3xl" />)}
      </div>
    );
  }

  return <BusinessKpiChartsView data={data} />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function BusinessKpiChartsView({ data, tier }: { data: any; tier?: import("@/lib/plans").PlanTier }) {
  const hasThisMonth = data.daily.some((d: { count: number }) => Number(d.count) > 0);
  const roleData = data.role_mix.map((r: { role: string; count: number }) => ({ role: ROLE_LABEL[r.role] ?? r.role, count: r.count }));
  const treeData = data.stores.map((s: { name: string; count: number; amount: number }, i: number) => ({ name: s.name, size: s.count, amount: s.amount, fill: C.stores[i % C.stores.length] }));
  const scatterData = data.partners.map((p: { count: number; rate: number; amount: number; name: string }) => ({ x: p.count, y: p.rate, z: p.amount, name: p.name }));
  const ranked = ([...data.partners] as Array<{ name: string; count: number }>).slice(0, 8).reverse();
  // Every multi-series chart renders exactly the networks present in the data.
  // With no data yet, show the standard operator set so the chart shape is clear.
  const { can } = usePlanFeatures(tier);
  const DEFAULT_NETWORKS = ["Jazz", "Telenor", "Zong", "Ufone"];
  const networks: string[] = (data.networks ?? []).length ? data.networks : DEFAULT_NETWORKS;
  const netColor = (n: string, i: number) => brandColorFor(n, C.stores[i % C.stores.length]!);

  type MonthRow = Record<string, number | string>;
  const months = (data.monthly ?? []) as MonthRow[];
  // Network share (donut) — totals across the visible months.
  const netShare = networks
    .map((n, i) => ({
      name: n,
      value: months.reduce((s, m) => s + (Number(m[n]) || 0), 0),
      fill: netColor(n, i),
    }))
    .filter((d) => d.value > 0);
  const netShareTotal = netShare.reduce((s, d) => s + d.value, 0);

  // Revenue split by store (pie).
  const storePie = (data.stores as Array<{ name: string; amount: number }>)
    .map((s, i) => ({ name: s.name, value: Number(s.amount) || 0, fill: C.stores[i % C.stores.length] }))
    .filter((d) => d.value > 0);

  // Store volume (gradient columns).
  const storeBars = (data.stores as Array<{ name: string; count: number }>).slice(0, 8);

  // Target progress rings — top partners against the leader's volume.
  const topPartners = (data.partners as Array<{ name: string; count: number }>).slice(0, 5);
  const leader = Math.max(1, ...topPartners.map((p) => p.count));
  const radialData = topPartners
    .map((p, i) => ({ name: p.name, value: Math.round((p.count / leader) * 100), count: p.count, fill: C.stores[i % C.stores.length] }))
    .reverse();

  // Effective rate per month (step line).
  const rateSeries = months.map((m) => ({
    label: String(m.label),
    rate: Number(m.count) ? Math.round(Number(m.amount) / Number(m.count)) : 0,
  }));

  // Isometric 3D pie — operator share of activations.
  const isoNet = (netShare.length ? netShare : networks.map((n, i) => ({ name: n, value: 1, fill: netColor(n, i) })))
    .map((d: { name: string; value: number; fill: string }) => ({ name: d.name, value: d.value, color: d.fill }));

  // Average payout rate per operator — where the best margins come from.
  const netRate = ((data.network_stats ?? []) as Array<{ name: string; rate: number; count: number }>)
    .slice(0, 8)
    .map((n) => ({ name: n.name, rate: n.rate, count: n.count }));

  // Processing pipeline funnel — data quality from upload to billable activation.
  const q = data.quality ?? { total: 0, success: 0, duplicate: 0, failed: 0, pending: 0 };
  const pipelineRaw = [
    { name: "Uploaded", value: Number(q.total) || 0, fill: "#6366f1" },
    { name: "Read by OCR", value: Math.max(0, (Number(q.total) || 0) - (Number(q.failed) || 0)), fill: "#0ea5e9" },
    { name: "Unique", value: Math.max(0, (Number(q.total) || 0) - (Number(q.failed) || 0) - (Number(q.duplicate) || 0)), fill: "#14b8a6" },
    { name: "Billable", value: Number(q.success) || 0, fill: "#22c55e" },
  ];
  const pipeline = pipelineRaw[0]!.value > 0 ? pipelineRaw : [{ name: "No uploads yet", value: 1, fill: "#cbd5e1" }];

  // Extruded 3D ring — commission earned by the top partners.
  const ringSrc = (data.partners as Array<{ name: string; amount: number; count: number }>).filter((p) => p.amount > 0).slice(0, 5);
  const ringData = (ringSrc.length
    ? ringSrc.map((p, i) => ({ name: p.name, value: Math.round(p.amount), caption: `${p.count} acts`, color: C.stores[i % C.stores.length]! }))
    : [{ name: "No revenue yet", value: 0, caption: "this month", color: "#cbd5e1" }]);

  // Month-end projection from the current run rate vs last month's total.
  const mtd = Number(months[months.length - 1]?.count ?? 0);
  const dayOfMonth = Math.max(1, Number(data.day_of_month ?? 1));
  const daysInMonth = Number(data.days_in_month ?? 30);
  const projected = Math.round((mtd / dayOfMonth) * daysInMonth);
  const lastMonthTotal = Number(months[months.length - 2]?.count ?? 0);




  // Panels render into a 6-col grid at 1/3 width. When the tail of the grid
  // would leave a lone card in a row, those trailing cards become half-width
  // so every row stays full whatever the plan unlocks.
  const panels = (
    <>


        {/* 1 — Stacked area per network + cumulative line (pace this month) */}
        <Panel
          title="Activation pace"
          subtitle={networks.length ? `Daily activations by network — ${networks.join(", ")}` : "Daily activations with running total this month"}
          height={280}
        >
          <ComposedChart data={data.daily} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.pace} stopOpacity={0.55} />
                <stop offset="100%" stopColor={C.pace} stopOpacity={0.03} />
              </linearGradient>
              {networks.map((n, i) => (
                <linearGradient key={n} id={`paceNet${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={netColor(n, i)} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={netColor(n, i)} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 4" stroke="rgba(15,23,42,0.05)" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis yAxisId="l" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} fontSize={11} />
            <Tooltip {...tip} />
            {networks.length > 0 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {networks.length > 0 ? (
              networks.map((n, i) => (
                <Area
                  key={n}
                  yAxisId="l"
                  type="monotone"
                  dataKey={n}
                  name={n}
                  stackId="net"
                  stroke={netColor(n, i)}
                  strokeWidth={2}
                  fill={`url(#paceNet${i})`}
                />
              ))
            ) : (
              <Area yAxisId="l" type="monotone" dataKey="count" name="Activations" stroke={C.pace} strokeWidth={2} fill="url(#paceFill)" />
            )}
            <Line yAxisId="r" type="monotone" dataKey="cumulative" name="Running total" stroke={C.paceAlt} strokeWidth={2.5} dot={false} />
          </ComposedChart>
        </Panel>

        {/* 2 — Grouped bars per network + commission line (momentum across months) */}
        <Panel
          title="Monthly momentum"
          subtitle={networks.length ? `Activations by network vs commission, last 6 months` : "Activations vs commission, last 6 months"}
          height={280}
        >
          <ComposedChart data={data.monthly} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="momBar" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor={C.momentumAlt} stopOpacity={0.85} />
                <stop offset="100%" stopColor={C.momentum} stopOpacity={1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 4" stroke="rgba(15,23,42,0.05)" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis yAxisId="l" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
            <Tooltip {...tip} formatter={(v: number, n: string) => (n === "Commission" ? pkr(v) : v)} />
            {networks.length > 0 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {networks.length > 0 ? (
              networks.map((n, i) => (
                <Bar
                  key={n}
                  yAxisId="l"
                  dataKey={n}
                  name={n}
                  fill={netColor(n, i)}
                  radius={[6, 6, 2, 2]}
                  maxBarSize={22}
                />
              ))
            ) : (
              <Bar yAxisId="l" dataKey="count" name="Activations" fill="url(#momBar)" radius={[8, 8, 4, 4]} barSize={26} />
            )}
            <Line yAxisId="r" type="monotone" dataKey="amount" name="Commission" stroke="currentColor" className="text-foreground" strokeWidth={2} dot={{ r: 3, fill: "currentColor" }} />
          </ComposedChart>
        </Panel>


        {/* 3 — Radar (role mix) */}
        {can("leaderboard") && (
        <Panel title="Channel mix" subtitle="Activations by partner role this month" height={280}>
          <RadarChart data={roleData.length ? roleData : [{ role: "No data", count: 0 }]} outerRadius="72%">
            <PolarGrid stroke="rgba(15,23,42,0.12)" />
            <PolarAngleAxis dataKey="role" fontSize={11} />
            <PolarRadiusAxis fontSize={10} stroke="rgba(15,23,42,0.2)" />
            <Tooltip {...tip} />
            <Radar name="Activations" dataKey="count" stroke={C.mix} strokeWidth={2} fill={C.mix} fillOpacity={0.35} />
          </RadarChart>
        </Panel>
        )}

        {/* 4 — Horizontal ranked bars (top partners) */}
        {can("leaderboard") && (
        <Panel title="Partner leaderboard" subtitle="Top performers this month" height={280}>
          <BarChart data={ranked} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 6" stroke="rgba(15,23,42,0.08)" horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} fontSize={11} />
            <Tooltip {...tip} formatter={(v: number) => `${v} activations`} />
            <Bar dataKey="count" name="Activations" radius={[4, 10, 10, 4]} barSize={16}>
              {ranked.map((_, i) => (
                <Cell key={i} fill={C.stores[i % C.stores.length]} />
              ))}
              <LabelList dataKey="count" position="right" fontSize={11} fill="currentColor" className="text-foreground" />
            </Bar>
          </BarChart>
        </Panel>
        )}

        {/* 5 — Treemap (store contribution) */}
        {can("store_performance") && (
        <Panel title="Store contribution" subtitle="Share of activations by store this month" height={300}>
          <Treemap
            data={treeData.length ? treeData : [{ name: "No data", size: 1, amount: 0, fill: "#cbd5e1" }]}
            dataKey="size"
            stroke="#fff"
            isAnimationActive={false}
            content={<TreeCell />}
          >
            <Tooltip {...tip} formatter={(v: number) => `${v} activations`} />
          </Treemap>
        </Panel>
        )}

        {/* 6 — Bubble scatter (volume vs rate) */}
        {can("commissions") && (
        <Panel title="Volume vs rate" subtitle="Each bubble is a partner — size is commission earned" height={300}>
          <ScatterChart margin={{ top: 12, right: 16, left: -8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 6" stroke="rgba(15,23,42,0.08)" />
            <XAxis type="number" dataKey="x" name="Activations" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis type="number" dataKey="y" name="Rate" tickLine={false} axisLine={false} fontSize={11} />
            <ZAxis type="number" dataKey="z" range={[80, 900]} name="Commission" />
            <Tooltip
              {...tip}
              cursor={{ strokeDasharray: "3 3" }}
              formatter={(v: number, n: string) => (n === "Commission" || n === "Rate" ? pkr(v) : v)}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Scatter
              name="Partners"
              data={scatterData.length ? scatterData : []}
              fill={C.scatter}
              fillOpacity={0.55}
              stroke={C.scatter}
            />
          </ScatterChart>
        </Panel>
        )}

        {/* 7 — Isometric 3D pie (network share) */}
        <Panel title="Network share" subtitle="Activation split across operators" height={300} raw>
          <IsoPie3D data={isoNet} height={270} unit="acts" />
        </Panel>

        {/* 8 — Classic pie (revenue by store) */}
        {can("commissions") && (
        <Panel title="Revenue by store" subtitle="Commission share per store ID" height={300}>
          <PieChart>
            <Tooltip {...tip} formatter={(v: number) => pkr(v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Pie
              data={storePie.length ? storePie : [{ name: "No data", value: 1, fill: "#cbd5e1" }]}
              dataKey="value"
              nameKey="name"
              outerRadius="80%"
              stroke="#fff"
              strokeWidth={2}
              labelLine={false}
              label={({ percent }: { percent?: number }) => `${Math.round((percent ?? 0) * 100)}%`}
            />
          </PieChart>
        </Panel>
        )}

        {/* 9 — Radial progress rings (partner vs leader) */}
        {can("leaderboard") && (
        <Panel title="Partner target progress" subtitle="Each ring is % of the top performer's volume" height={300}>
          <RadialBarChart
            data={radialData.length ? radialData : [{ name: "No data", value: 0, count: 0, fill: "#cbd5e1" }]}
            innerRadius="30%"
            outerRadius="76%"
            cx="32%"
            startAngle={90}
            endAngle={-270}
            barSize={12}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar background={{ fill: "rgba(15,23,42,0.06)" }} dataKey="value" cornerRadius={8} />
            <Tooltip {...tip} formatter={(v: number, _n: string, p: { payload?: { count?: number } }) => `${p?.payload?.count ?? 0} activations (${v}%)`} />
            <Legend wrapperStyle={{ fontSize: 10, lineHeight: "18px", right: 0, width: 110 }} iconSize={8} layout="vertical" verticalAlign="middle" align="right" />
          </RadialBarChart>
        </Panel>
        )}

        {/* 10 — Gradient columns (payout rate per network) */}
        {can("commissions") && (
        <Panel title="Rate by network" subtitle="Average PKR earned per activation, per operator" height={280}>
          <BarChart data={netRate.length ? netRate : [{ name: "No data", rate: 0 }]} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="netRateCol" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 6" stroke="rgba(15,23,42,0.08)" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis tickLine={false} axisLine={false} fontSize={11} />
            <Tooltip {...tip} cursor={{ fill: "rgba(99,102,241,0.06)" }} formatter={(v: number) => pkr(v)} />
            <Bar dataKey="rate" name="Rate" radius={[10, 10, 4, 4]} maxBarSize={38}>
              {netRate.map((d, i) => <Cell key={i} fill={netColor(d.name, i)} />)}
              <LabelList dataKey="rate" position="top" fontSize={10} fill="#0f172a" />
            </Bar>
          </BarChart>
        </Panel>
        )}

        {/* 11 — Funnel (processing pipeline health) */}
        <Panel title="Processing pipeline" subtitle="Uploads → clean, billable activations this month" height={280}>
          <FunnelChart margin={{ top: 8, right: 78, left: 0, bottom: 8 }}>
            <Tooltip {...tip} formatter={(v: number) => `${v} records`} />
            <Funnel data={pipeline} dataKey="value" isAnimationActive={false}>
              <LabelList position="center" dataKey="name" fontSize={11} fontWeight={600} fill="#ffffff" />
              <LabelList position="right" dataKey="value" fontSize={11} fill="#0f172a" offset={10} />
            </Funnel>
          </FunnelChart>
        </Panel>

        {/* 12 — Step line (effective rate per month) */}
        {can("commissions") && (
        <Panel title="Effective rate trend" subtitle="Average PKR earned per activation, by month" height={280}>
          <LineChart data={rateSeries.length ? rateSeries : [{ label: "—", rate: 0 }]} margin={{ top: 16, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 6" stroke="rgba(15,23,42,0.08)" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis tickLine={false} axisLine={false} fontSize={11} />
            <Tooltip {...tip} formatter={(v: number) => pkr(v)} />
            <Line
              type="stepAfter"
              dataKey="rate"
              name="Effective rate"
              stroke="#f43f5e"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#f43f5e", strokeWidth: 0 }}
              activeDot={{ r: 6 }}
            >
              <LabelList dataKey="rate" position="top" fontSize={10} fill="#0f172a" />
            </Line>
          </LineChart>
        </Panel>
        )}

        {/* 13 — Extruded 3D step ring (revenue leaders) */}
        {can("commissions") && (
        <Panel title="Revenue leaders" subtitle="Commission earned by your top partners this month" height={340} raw>
          <Ring3DSteps data={ringData} height={270} />
        </Panel>
        )}

        {/* 14 — Calendar heatmap (daily intensity) */}
        <Panel title="Activation calendar" subtitle="Daily intensity across the current month" height={300} raw>
          <div className="px-2">
            <CalendarHeatmap data={data.calendar ?? []} height={262} />
          </div>
        </Panel>

        {/* 15 — Gauge (month-end projection vs last month) */}
        <Panel title="Month-end projection" subtitle="Run-rate forecast against last month's total" height={300} raw>
          <PaceGauge value={mtd} projected={projected} target={lastMonthTotal} height={270} />
        </Panel>
    </>
  );

  const items = React.Children.toArray(panels.props.children).filter(Boolean);
  const rem = items.length % 3;
  const tail = rem === 1 ? 4 : rem === 2 ? 2 : 0;
  const spanFor = (i: number) =>
    tail > 0 && i >= items.length - tail ? "xl:col-span-3" : "xl:col-span-2";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6 auto-rows-fr items-stretch">
        {items.map((c, i) => (
          <div key={i} className={`h-full ${spanFor(i)}`}>{c}</div>
        ))}
      </div>

      {!hasThisMonth && (
        <p className="text-xs text-muted-foreground">No activations recorded yet this month — charts fill in as orders are extracted.</p>
      )}
    </div>
  );
}



// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TreeCell(props: any) {
  const { x, y, width, height, name, fill, size } = props;
  if (width == null || height == null) return null;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={10} fill={fill} fillOpacity={0.85} stroke="#fff" strokeWidth={2} />
      {width > 64 && height > 34 && (
        <>
          <text x={x + 10} y={y + 20} fill="#fff" fontSize={12} fontWeight={600}>{name}</text>
          <text x={x + 10} y={y + 36} fill="rgba(255,255,255,0.85)" fontSize={11}>{size}</text>
        </>
      )}
    </g>
  );
}
