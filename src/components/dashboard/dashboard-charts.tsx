// Dashboard chart & card primitives extracted from dashboard.tsx.
// Pure presentational components — no data fetching or business logic.
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend, RadialBarChart, RadialBar,
  AreaChart, Area, Treemap, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  FunnelChart, Funnel, LabelList, Sector,
} from "recharts";
import {
  CHART, BAR_PALETTE, PIE_PALETTE, PALETTES, NETWORK_BRAND_COLORS,
  brandColorFor, gradFor, NEON_CARD, NEON_TOOLTIP, NEON_TOOLTIP_ITEM,
  NEON_TOOLTIP_LABEL, NEON_FILTER, RichTooltip,
  type CatProps,
} from "./chart-theme";

export function StatCard({
  icon: Icon,
  label,
  value,
  loading,
  tone = "default",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  loading?: boolean;
  tone?: "default" | "success" | "danger" | "warn" | "muted";
}) {
  // The fixed emerald/amber shades are dark enough to read on a white card but
  // muddy on a near-black one, so each gets a lighter dark-mode counterpart.
  // The rest are already theme tokens and flip on their own.
  const toneCfg = {
    default: { text: "text-foreground", chip: "bg-primary/10 text-primary" },
    success: { text: "text-emerald-600 dark:text-emerald-400", chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
    danger: { text: "text-destructive", chip: "bg-destructive/10 text-destructive" },
    warn: { text: "text-amber-600 dark:text-amber-400", chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
    muted: { text: "text-foreground", chip: "bg-muted text-muted-foreground" },
  }[tone];
  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)] transition-transform hover:-translate-y-0.5">
      <CardContent className="pt-6">
        {/* items-start, not items-center: a label that wraps to two lines should
            keep the icon pinned to the top rather than drifting down beside it.
            shrink-0 on the chip and min-w-0 on the label are what stop a single
            long word — "PROCESSING" is the one that showed it — from running
            underneath the icon instead of wrapping. */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 break-words text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
          <div className={`h-8 w-8 shrink-0 rounded-2xl grid place-items-center ${toneCfg.chip}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
        <div className={`font-display text-3xl font-bold tracking-tight ${toneCfg.text}`}>{loading ? "—" : value}</div>
      </CardContent>
    </Card>
  );
}

// Editorial-style pie: exploded wedges, big % inside slices, external polyline
// labels with the category name — inspired by infographic/report visuals.
export function renderEditorialPieLabel(palette: string[], offset: number) {
  return function EditorialPieLabel(props: Record<string, unknown>) {
    const { cx, cy, midAngle, innerRadius, outerRadius, percent, name, index } = props as {
      cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number;
      percent: number; name: string; index: number;
    };
    const RAD = Math.PI / 180;
    const sin = Math.sin(-midAngle * RAD);
    const cos = Math.cos(-midAngle * RAD);
    // Inside percent label
    const pr = innerRadius + (outerRadius - innerRadius) * 0.55;
    const px = cx + pr * cos;
    const py = cy + pr * sin;
    // External callout
    const sx = cx + (outerRadius + 4) * cos;
    const sy = cy + (outerRadius + 4) * sin;
    const mx = cx + (outerRadius + 10) * cos;
    const my = cy + (outerRadius + 10) * sin;
    const ex = mx + (cos >= 0 ? 1 : -1) * 8;
    const ey = my;
    const textAnchor = cos >= 0 ? "start" : "end";
    const color = palette[(index + offset) % palette.length];
    const pct = Math.round((percent ?? 0) * 100);
    if (pct < 1) return null as unknown as React.ReactElement;
    return (
      <g>
        {pct >= 6 && (
          <text x={px} y={py} textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontSize={16} fontWeight={800} style={{ textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
            {pct}%
          </text>
        )}
        <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={color} strokeWidth={1.2} fill="none" opacity={0.85} />
        <circle cx={ex} cy={ey} r={2.5} fill={color} />
        <text x={ex + (cos >= 0 ? 6 : -6)} y={ey - 2} textAnchor={textAnchor} fill="currentColor" className="text-slate-800" fontSize={11} fontWeight={600}>
          {name.length > 16 ? name.slice(0, 15) + "…" : name}
        </text>
        <text x={ex + (cos >= 0 ? 6 : -6)} y={ey + 11} textAnchor={textAnchor} fill="currentColor" className="text-muted-foreground" fontSize={10}>
          {pct}%
        </text>
      </g>
    );
  };
}

// Half-donut editorial chart — semicircle with big % inside large slices,
// external polyline callouts to category names, and a compact side list for
// remaining smaller slices. Inspired by infographic report visuals.
export function CategoryHalfDonut({ title, data, offset = 0, palette = PIE_PALETTE }: { title: string; data: { name: string; count: number }[]; offset?: number; palette?: string[] }) {
  const total = data.reduce((a, b) => a + b.count, 0);
  const sorted = data.slice().sort((a, b) => b.count - a.count);
  const rows = sorted.map((d, i) => ({
    ...d,
    pct: total > 0 ? (d.count / total) * 100 : 0,
    color: palette[(i + offset) % palette.length],
  }));

  // SVG geometry — upper semicircle only (fan opens upward)
  const W = 520;
  const H = 260;
  const cx = W / 2;
  const cy = H - 20;          // baseline near bottom
  const rOuter = 170;
  const rInner = 70;
  const rLabel = 195;

  // Sweep from left (180°) to right (0°) across the top
  const toRad = (deg: number) => (Math.PI * deg) / 180;
  const polar = (r: number, deg: number) => ({
    x: cx + r * Math.cos(toRad(deg)),
    y: cy - r * Math.sin(toRad(deg)), // minus because SVG y grows downward
  });

  let acc = 180;
  const slices = rows.map((r) => {
    const sweep = total > 0 ? (r.count / total) * 180 : 0;
    const startDeg = acc;
    const endDeg = acc - sweep;
    const midDeg = (startDeg + endDeg) / 2;
    acc = endDeg;

    const p0 = polar(rOuter, startDeg);
    const p1 = polar(rOuter, endDeg);
    const p2 = polar(rInner, endDeg);
    const p3 = polar(rInner, startDeg);
    const largeArc = sweep > 180 ? 1 : 0;
    // Outer arc sweeps over the top (sweep-flag 1); inner returns underneath (0)
    const d = [
      `M ${p0.x} ${p0.y}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p1.x} ${p1.y}`,
      `L ${p2.x} ${p2.y}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p3.x} ${p3.y}`,
      "Z",
    ].join(" ");

    const labelPoint = polar(rLabel, midDeg);
    const anchorRight = labelPoint.x >= cx;
    return { ...r, d, midDeg, labelPoint, anchorRight, sweep };
  });

  // Only slices ≥8% get in-chart callouts; smaller ones are shown by % label only
  const bigThreshold = 8;
  const bigs = slices.filter((s) => s.pct >= bigThreshold);

  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
      <CardHeader><CardTitle className="text-base font-semibold text-foreground">{title}</CardTitle></CardHeader>
      <CardContent className="h-[22rem] p-3">
        <div className="relative h-full w-full">
          <svg viewBox={`70 25 380 220`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
            <defs>
              {slices.map((s, i) => (
                <linearGradient key={i} id={`half-grad-${i}-${s.color.replace(/[^a-zA-Z0-9]/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.75} />
                </linearGradient>
              ))}
            </defs>
            {slices.map((s, i) => (
              <path
                key={i}
                d={s.d}
                fill={`url(#half-grad-${i}-${s.color.replace(/[^a-zA-Z0-9]/g, "")})`}
                stroke="#ffffff"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            ))}
            {/* Callouts for big slices */}
            {bigs.map((s, i) => {
              const anchor = polar(rOuter, s.midDeg);
              const bend = polar(rOuter + 18, s.midDeg);
              const end = { x: s.anchorRight ? Math.min(W - 8, bend.x + 22) : Math.max(8, bend.x - 22), y: bend.y };
              return (
                <g key={`cb-${i}`}>
                  <polyline
                    points={`${anchor.x},${anchor.y} ${bend.x},${bend.y} ${end.x},${end.y}`}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={1.5}
                  />
                  <circle cx={anchor.x} cy={anchor.y} r={2.5} fill={s.color} />
                  <text
                    x={end.x + (s.anchorRight ? 5 : -5)}
                    y={end.y - 3}
                    textAnchor={s.anchorRight ? "start" : "end"}
                    fontSize="13"
                    fontWeight={700}
                    fill="currentColor"
                    className="text-foreground"
                  >
                    {s.name}
                  </text>
                </g>
              );
            })}
            {/* Big % labels inside big slices */}
            {bigs.map((s, i) => {
              const p = polar((rOuter + rInner) / 2, s.midDeg);
              return (
                <text
                  key={`pc-${i}`}
                  x={p.x}
                  y={p.y + 6}
                  textAnchor="middle"
                  fontSize="18"
                  fontWeight={800}
                  fill="#ffffff"
                  style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.28)", strokeWidth: 2.5 }}
                >
                  {Math.round(s.pct)}%
                </text>
              );
            })}
            {/* Baseline under the dome */}
            <line x1={cx - rOuter} y1={cy} x2={cx + rOuter} y2={cy} stroke="#e2e8f0" strokeWidth={1} />
            {/* Total label sits inside the inner opening of the dome */}
            <text x={cx} y={cy - 34} textAnchor="middle" fontSize="11" fill="currentColor" className="text-muted-foreground" letterSpacing="1.8" fontWeight={600}>TOTAL</text>
            <text x={cx} y={cy - 10} textAnchor="middle" fontSize="24" fontWeight={800} fill="currentColor" className="text-foreground">{total}</text>
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}

// Infographic-style donut: each slice has an external callout with a colored
// pill showing name, count, and percentage. Center hole shows the title and total.
export function CategoryExplodedPie({ title, data, offset = 0, palette = PIE_PALETTE }: { title: string; data: { name: string; count: number }[]; offset?: number; palette?: string[] }) {
  const total = data.reduce((a, b) => a + b.count, 0);
  const sorted = [...data].sort((a, b) => b.count - a.count);
  const stats = sorted.map((d, i) => ({
    ...d,
    color: palette[(i + offset) % palette.length],
    pct: total > 0 ? Math.round((d.count / total) * 100) : 0,
  }));

  // SVG geometry
  const W = 520;
  const H = 360;
  const cx = W / 2;
  const cy = H / 2;
  const rOuter = 108;
  const rInner = 64;
  const RAD = Math.PI / 180;

  // Compute slice arcs (start at top, going clockwise)
  let acc = 0;
  const slices = stats.map((s) => {
    const start = (acc / (total || 1)) * 360;
    acc += s.count;
    const end = (acc / (total || 1)) * 360;
    const mid = (start + end) / 2;
    return { ...s, start, end, mid };
  });

  const arcPath = (startDeg: number, endDeg: number) => {
    // 12 o'clock is -90; sweep clockwise
    const a1 = (startDeg - 90) * RAD;
    const a2 = (endDeg - 90) * RAD;
    const x1o = cx + rOuter * Math.cos(a1), y1o = cy + rOuter * Math.sin(a1);
    const x2o = cx + rOuter * Math.cos(a2), y2o = cy + rOuter * Math.sin(a2);
    const x1i = cx + rInner * Math.cos(a2), y1i = cy + rInner * Math.sin(a2);
    const x2i = cx + rInner * Math.cos(a1), y2i = cy + rInner * Math.sin(a1);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${x1o} ${y1o} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2o} ${y2o} L ${x1i} ${y1i} A ${rInner} ${rInner} 0 ${large} 0 ${x2i} ${y2i} Z`;
  };

  // Assign each slice to left or right side, then stack vertically to avoid overlap
  // Order callouts by angular position so connector lines never cross a slice:
  // topmost slice on each side gets the topmost label lane.
  // mid=0 is 12 o'clock, sweeping clockwise → right side is mid in [0,180], left is (180,360).
  const leftSlices = slices.filter((s) => s.mid > 180).sort((a, b) => b.mid - a.mid);
  const rightSlices = slices.filter((s) => s.mid <= 180).sort((a, b) => a.mid - b.mid);

  const laneY = (index: number, count: number) => {
    if (count === 0) return cy;
    const gap = 62;
    const totalH = (count - 1) * gap;
    return cy - totalH / 2 + index * gap;
  };

  const gradId = (i: number) => `netgrad-${i}`;

  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
      <CardHeader><CardTitle className="text-base font-semibold text-foreground">{title}</CardTitle></CardHeader>
      <CardContent className="relative pb-3">
        <div className="flex justify-center">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[560px]" role="img" aria-label={`${title} distribution`}>
            <defs>
              {slices.map((s, i) => (
                <linearGradient key={i} id={gradId(i)} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={1} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.78} />
                </linearGradient>
              ))}
            </defs>

            {/* Donut slices */}
            {slices.map((s, i) => {
              const isSingle = slices.length === 1;
              const d = isSingle
                ? `M ${cx} ${cy - rOuter} A ${rOuter} ${rOuter} 0 1 1 ${cx - 0.01} ${cy - rOuter} L ${cx - 0.01} ${cy - rInner} A ${rInner} ${rInner} 0 1 0 ${cx} ${cy - rInner} Z`
                : arcPath(s.start, s.end);
              return (
                <path
                  key={s.name}
                  d={d}
                  fill={`url(#${gradId(i)})`}
                  stroke="#ffffff"
                  strokeWidth={3}
                  strokeLinejoin="round"
                />
              );
            })}

            {/* Center hole label */}
            <circle cx={cx} cy={cy} r={rInner - 6} fill="var(--card)" stroke="var(--border)" strokeWidth={1.5} className="rounded-2xl" />
            <text x={cx} y={cy - 6} textAnchor="middle" fontSize={11} fontWeight={700} letterSpacing="2" fill="currentColor" className="text-muted-foreground">
              {title.toUpperCase()}
            </text>
            <text x={cx} y={cy + 18} textAnchor="middle" fontSize={26} fontWeight={900} fill="currentColor" className="text-foreground">
              {total}
            </text>

            {/* Left-side callouts */}
            {leftSlices.map((s, i) => {
              const ly = laneY(i, leftSlices.length);
              const a = (s.mid - 90) * RAD;
              const ax = cx + rOuter * Math.cos(a);
              const ay = cy + rOuter * Math.sin(a);
              const bendX = cx - rOuter - 22;
              const textEndX = 30;
              return (
                <g key={`L-${s.name}`}>
                  <polyline
                    points={`${ax},${ay} ${bendX},${ay} ${bendX},${ly} ${textEndX},${ly}`}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={1.5}
                    opacity={0.6}
                  />
                  <circle cx={ax} cy={ay} r={3.5} fill={s.color} />
                  <circle cx={textEndX} cy={ly} r={5} fill={s.color} />
                  <text x={textEndX + 12} y={ly - 3} textAnchor="start" fontSize={14} fontWeight={800} fill="currentColor" className="text-foreground">{s.name}</text>
                  <text x={textEndX + 12} y={ly + 13} textAnchor="start" fontSize={11} fontWeight={700} fill="currentColor" className="text-muted-foreground">
                    {s.count} · <tspan fill={s.color} fontWeight={900} fontSize={12}>{s.pct}%</tspan>
                  </text>
                </g>
              );
            })}

            {/* Right-side callouts */}
            {rightSlices.map((s, i) => {
              const ly = laneY(i, rightSlices.length);
              const a = (s.mid - 90) * RAD;
              const ax = cx + rOuter * Math.cos(a);
              const ay = cy + rOuter * Math.sin(a);
              const bendX = cx + rOuter + 22;
              const textEndX = W - 30;
              return (
                <g key={`R-${s.name}`}>
                  <polyline
                    points={`${ax},${ay} ${bendX},${ay} ${bendX},${ly} ${textEndX},${ly}`}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={1.5}
                    opacity={0.6}
                  />
                  <circle cx={ax} cy={ay} r={3.5} fill={s.color} />
                  <circle cx={textEndX} cy={ly} r={5} fill={s.color} />
                  <text x={textEndX - 12} y={ly - 3} textAnchor="end" fontSize={14} fontWeight={800} fill="currentColor" className="text-foreground">{s.name}</text>
                  <text x={textEndX - 12} y={ly + 13} textAnchor="end" fontSize={11} fontWeight={700} fill="currentColor" className="text-muted-foreground">
                    {s.count} · <tspan fill={s.color} fontWeight={900} fontSize={12}>{s.pct}%</tspan>
                  </text>
                </g>
              );
            })}

          </svg>
        </div>
      </CardContent>
    </Card>
  );
}



// Donut with a center title, external polyline callouts (name + %) for large
// slices on the right, and a compact legend list of the smaller slices on the
// left. Inspired by editorial breakdown charts.
// Donut label: always external polyline callouts (name + %) in dark text so
// it stays readable against the card background — never overlaps the ring.
export function renderDonutCalloutLabel(palette: string[], offset: number) {
  return function DonutCalloutLabel(props: Record<string, unknown>) {
    const { cx, cy, midAngle, outerRadius, percent, name, index } = props as {
      cx: number; cy: number; midAngle: number; outerRadius: number;
      percent: number; name: string; index: number;
    };
    const pct = Math.round((percent ?? 0) * 100);
    if (pct < 1) return null as unknown as React.ReactElement;
    const RAD = Math.PI / 180;
    const sin = Math.sin(-midAngle * RAD);
    const cos = Math.cos(-midAngle * RAD);
    const color = palette[(index + offset) % palette.length];
    const sx = cx + (outerRadius + 4) * cos;
    const sy = cy + (outerRadius + 4) * sin;
    const mx = cx + (outerRadius + 22) * cos;
    const my = cy + (outerRadius + 22) * sin;
    const ex = mx + (cos >= 0 ? 1 : -1) * 26;
    const ey = my;
    const textAnchor = cos >= 0 ? "start" : "end";
    return (
      <g>
        <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={color} strokeWidth={1.2} fill="none" opacity={0.85} />
        <circle cx={ex} cy={ey} r={2.5} fill={color} />
        <text x={ex + (cos >= 0 ? 6 : -6)} y={ey - 2} textAnchor={textAnchor} fill="#0f172a" fontSize={11} fontWeight={700}>
          {pct}%
        </text>
        <text x={ex + (cos >= 0 ? 6 : -6)} y={ey + 12} textAnchor={textAnchor} fill="#475569" fontSize={10} fontWeight={500}>
          {name.length > 14 ? name.slice(0, 13) + "…" : name}
        </text>
      </g>
    );
  };
}

// Full pie with a decorative outer ring gap, big % + name inside large slices,
// external polyline callouts for small slices.
export function CategoryRingedPie({ title, data, offset = 0, palette = PIE_PALETTE }: { title: string; data: { name: string; count: number }[]; offset?: number; palette?: string[] }) {
  const total = data.reduce((a, b) => a + b.count, 0);
  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
      <CardHeader><CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle></CardHeader>
      <CardContent className="h-64 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 24, right: 80, bottom: 24, left: 80 }}>
            {/* Decorative outer ring — sits behind the pie with a small gap. */}
            <Pie
              data={[{ name: "_ring", value: 1 }]}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius={112}
              outerRadius={118}
              startAngle={90}
              endAngle={-270}
              fill="#e2e8f0"
              stroke="none"
              isAnimationActive={false}
              label={false}
            />
            <Pie
              data={data}
              dataKey="count"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={0}
              outerRadius={100}
              paddingAngle={2}
              stroke="#ffffff"
              strokeWidth={3}
              style={NEON_FILTER}
              isAnimationActive
              label={(props: Record<string, unknown>) => {
                const { cx, cy, midAngle, innerRadius, outerRadius, percent, name } = props as { cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number; name: string };
                const pct = Math.round((percent ?? 0) * 100);
                if (pct < 10) return null as unknown as React.ReactElement;
                const RAD = Math.PI / 180;
                const pr = innerRadius + (outerRadius - innerRadius) * 0.6;
                const px = cx + pr * Math.cos(-midAngle * RAD);
                const py = cy + pr * Math.sin(-midAngle * RAD);
                return (
                  <g>
                    <text x={px} y={py - 6} textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontSize={16} fontWeight={800} style={{ textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>{pct}%</text>
                    <text x={px} y={py + 10} textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontSize={11} fontWeight={600} style={{ textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>{name}</text>
                  </g>
                );
              }}
              labelLine={false}
            >
              {data.map((_, i) => <Cell key={i} fill={gradFor(palette[(i + offset) % palette.length])} />)}
            </Pie>
            <Tooltip content={<RichTooltip total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute bottom-3 left-3 text-left">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Total</div>
          <div className="text-lg font-semibold tracking-tight text-slate-900">{total}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CategoryPictorial({ title, data, palette = PIE_PALETTE }: { title: string; data: { name: string; count: number }[]; palette?: string[] }) {
  const total = data.reduce((a, b) => a + b.count, 0);
  const rows = data.slice(0, 8).map((d, i) => ({
    ...d,
    pct: total > 0 ? Math.round((d.count / total) * 100) : 0,
    color: palette[i % palette.length],
  }));
  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
      <CardHeader><CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-5">
          {rows.map((r) => (
            <PersonFigure key={r.name} name={r.name} pct={r.pct} count={r.count} color={r.color} />
          ))}
        </div>
        <div className="mt-4 flex justify-end text-xs text-slate-500">
          <span>Total: <span className="font-semibold text-slate-800">{total}</span></span>
        </div>
      </CardContent>
    </Card>
  );
}

export function PersonFigure({ name, pct, count, color }: { name: string; pct: number; count: number; color: string }) {
  const uid = React.useId();
  const clipId = `pf-clip-${uid.replace(/[:]/g, "")}`;
  // Figure bounding box y: 4 (top of head) to 116 (bottom of feet). Height = 112.
  const yTop = 4;
  const height = 112;
  const fillY = yTop + height * (1 - pct / 100);
  return (
    <div className="flex flex-col items-center text-center">
      <svg viewBox="0 0 80 120" className="w-full h-32" aria-hidden>
        <defs>
          <clipPath id={clipId}>
            {/* Head */}
            <circle cx="40" cy="16" r="12" />
            {/* Body / arms / legs */}
            <path d="M22 40 Q22 32 30 32 L50 32 Q58 32 58 40 L58 68 L52 68 L52 110 Q52 116 46 116 Q40 116 40 110 L40 78 L40 110 Q40 116 34 116 Q28 116 28 110 L28 68 L22 68 Z" />
            {/* Extended arms */}
            <rect x="10" y="40" width="14" height="8" rx="4" />
            <rect x="56" y="40" width="14" height="8" rx="4" />
          </clipPath>
        </defs>
        {/* Background silhouette */}
        <g clipPath={`url(#${clipId})`}>
          <rect x="0" y="0" width="80" height="120" fill="#e2e8f0" />
          <rect x="0" y={fillY} width="80" height={120 - fillY} fill={color} />
        </g>
      </svg>
      <div className="mt-1 text-xs font-semibold text-slate-900 leading-tight break-words max-w-full px-1" title={name}>{name}</div>
      <div className="text-[11px] text-slate-500">{count} · {pct}%</div>
    </div>
  );
}



export function CategoryLegendDonut({ title, data, offset = 0, palette = PIE_PALETTE }: { title: string; data: { name: string; count: number }[]; offset?: number; palette?: string[] }) {
  const total = data.reduce((a, b) => a + b.count, 0);
  const rows = data.map((d, i) => ({
    ...d,
    pct: total > 0 ? Math.round((d.count / total) * 100) : 0,
    color: palette[(i + offset) % palette.length],
  }));
  const smalls = rows.filter((r) => r.pct < 8);
  const singleDominant = rows.length === 1 || (rows[0]?.pct ?? 0) >= 90;
  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
      <CardHeader><CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle></CardHeader>
      <CardContent className="h-64 relative">
        <div className="grid grid-cols-[auto_1fr] gap-3 h-full items-center">
          <ul className="flex flex-col gap-1.5 text-xs pl-1 self-center max-w-[150px]">
            {smalls.map((r) => (
              <li key={r.name} className="flex items-center gap-2 whitespace-nowrap justify-end">
                <span className="text-slate-700 truncate">{r.name}</span>
                <span className="inline-block w-2.5 h-4 rounded-2xl shrink-0" style={{ background: r.color, boxShadow: `0 0 6px ${r.color}55` }} />
              </li>
            ))}
          </ul>
          <div className="relative h-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 24, right: 100, bottom: 24, left: 100 }}>
                <Pie
                  data={rows}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={100}
                  paddingAngle={rows.length > 1 ? 2 : 0}
                  cornerRadius={0}
                  stroke="#ffffff"
                  strokeWidth={3}
                  style={NEON_FILTER}
                  isAnimationActive
                  label={renderDonutCalloutLabel(palette, offset)}
                  labelLine={false}
                >
                  {rows.map((r, i) => <Cell key={i} fill={gradFor(r.color)} />)}
                </Pie>
                <Tooltip content={<RichTooltip total={total} />} />
              </PieChart>
            </ResponsiveContainer>
            {!singleDominant && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 text-center leading-tight max-w-[110px] font-semibold">
                  Breakdown across<br />{title.replace(/^Top\s+/i, "all ")}
                </div>
                <div className="text-lg font-bold tracking-tight text-slate-900 mt-1">{total}</div>
              </div>
            )}
            {singleDominant && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Total</div>
                <div className="text-2xl font-bold tracking-tight text-slate-900">{total}</div>
                <div className="mt-1 text-[11px] font-semibold text-slate-700 text-center leading-tight max-w-[140px] break-words" title={rows[0]?.name}>
                  {rows[0]?.name}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}



export function CategorySimDonut({ title, data, palette = PIE_PALETTE }: { title: string; data: { name: string; count: number }[]; palette?: string[] }) {
  const total = data.reduce((a, b) => a + b.count, 0) || 1;
  const gid = React.useId().replace(/:/g, "");
  const cx = 150, cy = 150, r = 110, stroke = 26;
  const C = 2 * Math.PI * r;
  const gap = 8; // px gap between segments
  // Build cumulative arcs
  let acc = 0;
  const segments = data.map((d) => {
    const frac = d.count / total;
    const len = Math.max(0, frac * C - gap);
    const offset = -acc * C; // rotate around
    acc += frac;
    return { name: d.name, count: d.count, pct: Math.round(frac * 100), len, offset };
  });
  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
      <CardHeader><CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle></CardHeader>
      <CardContent className="h-80 relative flex flex-col">
        <div className="flex-1 min-h-0 relative flex items-center justify-center">
          <svg viewBox="0 0 300 300" className="w-full h-full max-h-[280px]">
            <defs>
              <linearGradient id={`sim-${gid}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#a78bfa" />
                <stop offset="50%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
              <filter id={`sh-${gid}`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="b" />
                <feOffset dy="4" in="b" result="o" />
                <feComponentTransfer in="o" result="c"><feFuncA type="linear" slope="0.25" /></feComponentTransfer>
                <feMerge><feMergeNode in="c" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {/* track */}
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef0f4" strokeWidth={stroke} />
            {/* segments — rotate -90 so 0° is top */}
            <g transform={`rotate(-90 ${cx} ${cy})`} filter={`url(#sh-${gid})`}>
              {segments.map((seg, i) => (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={`url(#sim-${gid})`}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={`${seg.len} ${C - seg.len}`}
                  strokeDashoffset={seg.offset}
                />
              ))}
            </g>
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Total</div>
            <div className="text-3xl font-bold tracking-tight text-slate-900 leading-tight mt-1">{data.reduce((a, b) => a + b.count, 0)}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-col items-start gap-2 px-6">
          {segments.map((seg, i) => {
            const color = palette[i % palette.length];
            return (
              <div key={seg.name} className="flex items-center gap-2.5 text-xs text-slate-700">
                <span className="inline-block w-2.5 h-2.5 rounded-2xl" style={{ background: color, boxShadow: `0 0 8px ${color}66` }} />
                <span>{seg.name}</span>
                <span className="font-bold text-slate-900">{seg.count}</span>
                <span className="text-slate-400">({seg.pct}%)</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function CategoryPie({ title, data, offset = 0, palette = PIE_PALETTE }: { title: string; data: { name: string; count: number }[]; offset?: number; palette?: string[] }) {
  const total = data.reduce((a, b) => a + b.count, 0);
  const trackData = [{ name: "_track", count: 1 }];
  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
      <CardHeader><CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle></CardHeader>
      <CardContent className="h-80 relative flex flex-col">
        <div className="flex-1 min-h-0 relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              {/* Grey background track */}
              <Pie
                data={trackData}
                dataKey="count"
                cx="50%"
                cy="50%"
                innerRadius={78}
                outerRadius={116}
                startAngle={90}
                endAngle={-270}
                stroke="none"
                isAnimationActive={false}
                fill="#eceef3"
              />
              {/* Foreground segments */}
              <Pie
                data={data}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={82}
                outerRadius={116}
                paddingAngle={4}
                cornerRadius={0}
                stroke="none"
                style={NEON_FILTER}
                isAnimationActive
                labelLine={false}
              >
                {data.map((_, i) => <Cell key={i} fill={gradFor(palette[(i + offset) % palette.length])} />)}
              </Pie>
              <Tooltip content={<RichTooltip total={total} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Total</div>
            <div className="text-3xl font-bold tracking-tight text-slate-900 leading-tight">{total}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-col items-start gap-2 px-6">
          {data.map((d, i) => {
            const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
            const color = palette[(i + offset) % palette.length];
            return (
              <div key={d.name} className="flex items-center gap-2.5 text-xs text-slate-700">
                <span className="inline-block w-2.5 h-2.5 rounded-2xl" style={{ background: color }} />
                <span>{d.name}</span>
                <span className="font-bold text-slate-900">{d.count}</span>
                <span className="text-slate-400">({pct}%)</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function CategoryBar({ title, data, offset = 0, palette = BAR_PALETTE }: { title: string; data: { name: string; count: number }[]; offset?: number; palette?: string[] }) {
  const total = data.reduce((a, b) => a + b.count, 0);
  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
      <CardHeader><CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle></CardHeader>
      <CardContent className="h-64 relative">
        <ResponsiveContainer width="100%" height="85%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} horizontal={false} />
            <XAxis type="number" fontSize={11} stroke={CHART.axis} allowDecimals={false} />
            <YAxis dataKey="name" type="category" fontSize={11} width={90} stroke={CHART.axis} />
            <Tooltip cursor={{ fill: "rgba(168,85,247,0.08)" }} content={<RichTooltip total={total} />} />
            <Bar dataKey="count" radius={[0, 0, 0, 0]} style={NEON_FILTER}>
              {data.map((_, i) => <Cell key={i} fill={gradFor(palette[(i + offset) % palette.length])} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-2 text-xs">
          {data.map((d, i) => (
            <span key={d.name} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-2xl" style={{ background: palette[(i + offset) % palette.length], boxShadow: `0 0 8px ${palette[(i + offset) % palette.length]}` }} />
              <span className="text-slate-600">{d.name}</span>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function CategoryRadial({ title, data, offset = 0, palette = PIE_PALETTE }: { title: string; data: { name: string; count: number }[]; offset?: number; palette?: string[] }) {
  const total = data.reduce((a, b) => a + b.count, 0);
  const rows = data.map((d, i) => ({
    ...d,
    color: palette[(i + offset) % palette.length],
    pct: total > 0 ? Math.round((d.count / total) * 100) : 0,
  }));
  const renderSliceLabel = (props: any) => {
    const { cx, cy, midAngle, innerRadius, outerRadius, index } = props;
    const r = innerRadius + (outerRadius - innerRadius) * 0.55;
    const RAD = Math.PI / 180;
    const x = cx + r * Math.cos(-midAngle * RAD);
    const y = cy + r * Math.sin(-midAngle * RAD);
    const row = rows[index];
    if (!row || row.pct < 6) return null;
    return (
      <g pointerEvents="none">
        <text x={x} y={y - 6} fill="#ffffff" textAnchor="middle" fontSize={14} fontWeight={800} style={{ textShadow: "0 1px 6px rgba(0,0,0,0.35)" }}>{row.pct}%</text>
        <text x={x} y={y + 10} fill="#ffffff" textAnchor="middle" fontSize={10} fontWeight={600} style={{ textShadow: "0 1px 6px rgba(0,0,0,0.35)" }}>{row.name}</text>
      </g>
    );
  };
  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
      <CardHeader><CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle></CardHeader>
      <CardContent className="h-64 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 12, right: 40, bottom: 12, left: 40 }}>
            {/* Outer light ring */}
            <Pie
              data={[{ name: "_ring", value: 1 }]}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius={92}
              outerRadius={98}
              startAngle={90}
              endAngle={-270}
              fill="#e2e8f0"
              stroke="none"
              isAnimationActive={false}
              label={false}
            />
            <Pie
              data={rows}
              dataKey="count"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={0}
              outerRadius={86}
              paddingAngle={1}
              stroke="#ffffff"
              strokeWidth={4}
              style={NEON_FILTER}
              isAnimationActive
              label={renderSliceLabel}
              labelLine={false}
            >
              {rows.map((r, i) => <Cell key={i} fill={gradFor(r.color)} />)}
            </Pie>
            <Tooltip content={<RichTooltip total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute bottom-3 left-3 text-left">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Total</div>
          <div className="text-lg font-semibold tracking-tight text-slate-900">{total}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CategoryTreemap({ title, data, offset = 0, palette = BAR_PALETTE }: { title: string; data: { name: string; count: number }[]; offset?: number; palette?: string[] }) {
  const rows = data.map((d, i) => ({ name: d.name, size: d.count, fill: gradFor(palette[(i + offset) % palette.length]) }));
  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
      <CardHeader><CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle></CardHeader>
      <CardContent className="h-64 relative">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap data={rows} dataKey="size" nameKey="name" stroke="#ffffff" content={<TreemapCell />} />
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function TreemapCell(props: Record<string, unknown>) {
  const { x, y, width, height, name, size, fill } = props as { x: number; y: number; width: number; height: number; name?: string; size?: number; fill?: string };
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={0} ry={0} style={{ fill, stroke: "#ffffff", strokeWidth: 2, filter: "url(#neon-glow)" }} />
      {width > 60 && height > 30 && name ? (
        <>
          <text x={x + 10} y={y + 20} fill="#fff" fontSize={11} fontWeight={700} style={{ textShadow: "0 0 8px rgba(0,0,0,0.6)" }}>{name}</text>
          <text x={x + 10} y={y + 36} fill="rgba(255,255,255,0.95)" fontSize={11}>{size}</text>
        </>
      ) : null}
    </g>
  );
}


export function CategoryDonut({ title, data, offset = 0, palette = PIE_PALETTE }: CatProps) {
  const total = data.reduce((a, b) => a + b.count, 0);
  const sorted = data.slice().sort((a, b) => b.count - a.count);
  const rows = sorted.map((d, i) => ({
    ...d,
    pct: total > 0 ? Math.round((d.count / total) * 100) : 0,
    color: palette[(i + offset) % palette.length],
  }));
  const top = rows[0];
  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
      <CardHeader><CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle></CardHeader>
      <CardContent className="h-64 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 8, right: 60, bottom: 8, left: 60 }}>
            <Pie
              data={rows}
              dataKey="count"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={84}
              paddingAngle={3}
              cornerRadius={0}
              stroke="#ffffff"
              strokeWidth={3}
              style={NEON_FILTER}
              isAnimationActive
              label={renderEditorialPieLabel(palette, offset)}
              labelLine={false}
            >
              {rows.map((r, i) => <Cell key={i} fill={gradFor(r.color)} />)}
            </Pie>
            <Tooltip content={<RichTooltip total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 text-center leading-tight max-w-[90px]">
            {top?.name ?? "—"}
          </div>
          <div className="text-xl font-bold tracking-tight text-slate-900">{top?.pct ?? 0}%</div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mt-1">Total {total}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CategoryColumn({ title, data, offset = 0, palette = BAR_PALETTE }: CatProps) {
  const total = data.reduce((a, b) => a + b.count, 0);
  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
      <CardHeader><CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle></CardHeader>
      <CardContent className="h-64 relative">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 15, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="name" fontSize={11} stroke={CHART.axis} interval={0} angle={data.length > 4 ? -20 : 0} textAnchor={data.length > 4 ? "end" : "middle"} height={data.length > 4 ? 50 : 30} />
            <YAxis fontSize={11} stroke={CHART.axis} allowDecimals={false} />
            <Tooltip cursor={{ fill: "rgba(168,85,247,0.08)" }} content={<RichTooltip total={total} />} />
            <Bar dataKey="count" radius={[0, 0, 0, 0]} style={NEON_FILTER} maxBarSize={48}>
              {data.map((_, i) => <Cell key={i} fill={gradFor(palette[(i + offset) % palette.length])} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function CategoryRadar({ title, data, offset = 0, palette = PIE_PALETTE }: CatProps) {
  const total = data.reduce((a, b) => a + b.count, 0);
  const accent = palette[offset % palette.length];
  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
      <CardHeader><CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle></CardHeader>
      <CardContent className="h-64 relative">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="78%">
            <PolarGrid stroke={CHART.grid} />
            <PolarAngleAxis dataKey="name" fontSize={11} stroke={CHART.axis} />
            <PolarRadiusAxis fontSize={10} stroke={CHART.axis} tick={false} axisLine={false} />
            <Tooltip content={<RichTooltip total={total} />} />
            <Radar dataKey="count" stroke={accent} strokeWidth={2} fill={gradFor(accent)} fillOpacity={0.55} style={NEON_FILTER} />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function CategoryFunnel({ title, data, offset = 0, palette = BAR_PALETTE }: CatProps) {
  const total = data.reduce((a, b) => a + b.count, 0);
  const rows = data
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((d, i) => ({ name: d.name, value: d.count, fill: gradFor(palette[(i + offset) % palette.length]) }));
  return (
    <Card className="rounded-2xl border border-border bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
      <CardHeader><CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle></CardHeader>
      <CardContent className="h-64 relative">
        <ResponsiveContainer width="100%" height="100%">
          <FunnelChart>
            <Tooltip content={<RichTooltip total={total} />} />
            <Funnel dataKey="value" data={rows} isAnimationActive stroke="#ffffff" strokeWidth={2} style={NEON_FILTER}>
              <LabelList position="right" fill="#0f172a" fontSize={11} stroke="none" dataKey="name" />
              <LabelList position="center" fill="#ffffff" fontSize={12} fontWeight={700} stroke="none" dataKey="value" />
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function Gauge({ label, pct, count, color }: { label: string; pct: number; count: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const cx = 100, cy = 90, r = 72;
  const startAngle = Math.PI; // 180deg
  const endAngle = 0;         // 0deg
  const valueAngle = startAngle + (endAngle - startAngle) * (clamped / 100);
  const arc = (from: number, to: number) => {
    const x1 = cx + r * Math.cos(from), y1 = cy - r * Math.sin(from);
    const x2 = cx + r * Math.cos(to),   y2 = cy - r * Math.sin(to);
    const large = Math.abs(to - from) > Math.PI ? 1 : 0;
    const sweep = to < from ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`;
  };
  const gid = React.useId().replace(/:/g, "");
  // needle
  const nLen = r - 4;
  const nx = cx + nLen * Math.cos(valueAngle);
  const ny = cy - nLen * Math.sin(valueAngle);
  // needle base perpendicular
  const perp = valueAngle + Math.PI / 2;
  const bw = 6;
  const bx1 = cx + bw * Math.cos(perp), by1 = cy - bw * Math.sin(perp);
  const bx2 = cx - bw * Math.cos(perp), by2 = cy + bw * Math.sin(perp);
  return (
    <div className="flex flex-col items-center">
      <div className="text-xl font-bold text-slate-800 tracking-tight leading-none mb-1">{clamped}%</div>
      <svg viewBox="0 0 200 120" className="w-full max-w-[190px] h-auto">
        <defs>
          <linearGradient id={`g-${gid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.85" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
          <linearGradient id={`b-${gid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f1f5f9" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>
          <filter id={`s-${gid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.5" />
          </filter>
        </defs>
        {/* background full arc */}
        <path d={arc(startAngle, endAngle)} stroke={`url(#b-${gid})`} strokeWidth="22" fill="none" strokeLinecap="butt" />
        {/* filled arc */}
        {clamped > 0 && (
          <path d={arc(startAngle, valueAngle)} stroke={`url(#g-${gid})`} strokeWidth="22" fill="none" strokeLinecap="butt" />
        )}
        {/* needle shadow */}
        <polygon
          points={`${bx1},${by1} ${bx2},${by2} ${nx},${ny}`}
          fill="#0f172a"
          filter={`url(#s-${gid})`}
          opacity="0.35"
          transform="translate(1.5,2)"
        />
        {/* needle */}
        <polygon
          points={`${bx1},${by1} ${bx2},${by2} ${nx},${ny}`}
          fill="#0f172a"
        />
        <circle cx={cx} cy={cy} r={7} fill="#0f172a" />
        <circle cx={cx} cy={cy} r={2.5} fill="#f8fafc" />
      </svg>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 mt-1">{label}</div>
      <div className="text-xs text-slate-700 font-medium">{count}</div>
    </div>
  );
}
