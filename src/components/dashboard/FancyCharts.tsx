// Hand-drawn SVG chart types recharts can't express: isometric 3D pie,
// extruded 3D step ring, month calendar heatmap and a projection gauge.
import * as React from "react";

const TAU = Math.PI * 2;

function shade(hex: string, amount: number) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const num = parseInt(full, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((num >> 16) & 255) * amount);
  const g = clamp(((num >> 8) & 255) * amount);
  const b = clamp((num & 255) * amount);
  return `rgb(${r},${g},${b})`;
}

type Slice = { name: string; value: number; color: string };

function ellipsePoint(cx: number, cy: number, rx: number, ry: number, a: number) {
  return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as const;
}

function arcSide(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, depth: number) {
  const [x0, y0] = ellipsePoint(cx, cy, rx, ry, a0);
  const [x1, y1] = ellipsePoint(cx, cy, rx, ry, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${rx} ${ry} 0 ${large} 1 ${x1} ${y1} L ${x1} ${y1 + depth} A ${rx} ${ry} 0 ${large} 0 ${x0} ${y0 + depth} Z`;
}

/** Front-facing (lower half) portion of an arc, used for the extruded side wall. */
function frontSpan(a0: number, a1: number) {
  const s = Math.max(a0, 0);
  const e = Math.min(a1, Math.PI);
  return e > s ? ([s, e] as const) : null;
}

/**
 * Isometric exploded 3D pie — slices sit on a plinth with callout labels.
 */
export function IsoPie3D({ data, height = 300, unit = "" }: { data: Slice[]; height?: number; unit?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const W = 420;
  const H = 300;
  const cx = 200;
  const cy = 168;
  const rx = 112;
  const ry = 56;
  const depth = 46;
  const explode = 12;

  let angle = -Math.PI / 2;
  const slices = data.map((d) => {
    const span = (d.value / total) * TAU;
    const a0 = angle;
    const a1 = angle + span;
    angle = a1;
    const mid = (a0 + a1) / 2;
    // A raised slice for the largest share gives the isometric "exploded" read.
    const lift = d.value === Math.max(...data.map((x) => x.value)) ? 26 : 0;
    const ox = Math.cos(mid) * explode;
    const oy = Math.sin(mid) * explode * 0.5 - lift;
    return { ...d, a0, a1, mid, ox, oy, pct: Math.round((d.value / total) * 100) };
  });

  const sorted = [...slices].sort((a, b) => Math.sin(a.mid) - Math.sin(b.mid));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} role="img">
      <ellipse cx={cx} cy={cy + depth + 26} rx={rx + 26} ry={ry * 0.9} fill="rgba(15,23,42,0.06)" />
      {sorted.map((s) => {
        const span = frontSpan(s.a0, s.a1) ?? frontSpan(s.a0 + TAU, s.a1 + TAU);
        if (!span) return null;
        return (
          <path
            key={`side-${s.name}`}
            d={arcSide(cx + s.ox, cy + s.oy, rx, ry, span[0], span[1], depth)}
            fill={shade(s.color, 0.72)}
          />
        );
      })}
      {slices.map((s) => {
        const c = { x: cx + s.ox, y: cy + s.oy };
        const [x0, y0] = ellipsePoint(c.x, c.y, rx, ry, s.a0);
        const [x1, y1] = ellipsePoint(c.x, c.y, rx, ry, s.a1);
        const large = s.a1 - s.a0 > Math.PI ? 1 : 0;
        const [lx, ly] = ellipsePoint(c.x, c.y, rx * 0.62, ry * 0.62, s.mid);
        const [ex, ey] = ellipsePoint(c.x, c.y, rx * 1.06, ry * 1.06, s.mid);
        const tx = ex + (Math.cos(s.mid) >= 0 ? 26 : -26);
        const ty = Math.sin(s.mid) > 0.3 ? cy + depth + 34 : ey - 26;
        return (
          <g key={s.name}>
            <path
              d={`M ${c.x} ${c.y} L ${x0} ${y0} A ${rx} ${ry} 0 ${large} 1 ${x1} ${y1} Z`}
              fill={s.color}
              stroke="#fff"
              strokeWidth={1.5}
            />
            <text x={lx} y={ly} textAnchor="middle" fontSize={11} fontWeight={700} fill="rgba(255,255,255,0.95)">
              {s.pct}%
            </text>
            <line x1={ex} y1={ey} x2={tx} y2={ty} stroke={s.color} strokeWidth={1.5} />
            <circle cx={ex} cy={ey} r={2.5} fill={s.color} />
            <text
              x={tx}
              y={ty - 4}
              textAnchor={Math.cos(s.mid) >= 0 ? "start" : "end"}
              fontSize={11}
              fontWeight={600}
              fill="currentColor"
              className="text-foreground"
            >
              {s.name}
            </text>
            <text
              x={tx}
              y={ty + 9}
              textAnchor={Math.cos(s.mid) >= 0 ? "start" : "end"}
              fontSize={10}
              fill="currentColor"
              className="text-muted-foreground"
            >
              {s.value.toLocaleString()}{unit ? ` ${unit}` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Extruded 3D ring with step callouts — mirrors the infographic style ring.
 */
export function Ring3DSteps({
  data,
  height = 320,
}: {
  data: Array<{ name: string; value: number; caption?: string; color: string }>;
  height?: number;
}) {
  const W = 460;
  const H = 320;
  const cx = 230;
  const cy = 160;
  const rx = 120;
  const ry = 62;
  const inner = 0.5;
  const depth = 34;
  const gap = 0.07;
  const n = Math.max(1, data.length);

  const segs = data.map((d, i) => {
    const step = TAU / n;
    const a0 = -Math.PI / 2 + i * step + gap / 2;
    const a1 = a0 + step - gap;
    return { ...d, a0, a1, mid: (a0 + a1) / 2 };
  });

  const annulus = (c: { x: number; y: number }, a0: number, a1: number) => {
    const [ox0, oy0] = ellipsePoint(c.x, c.y, rx, ry, a0);
    const [ox1, oy1] = ellipsePoint(c.x, c.y, rx, ry, a1);
    const [ix1, iy1] = ellipsePoint(c.x, c.y, rx * inner, ry * inner, a1);
    const [ix0, iy0] = ellipsePoint(c.x, c.y, rx * inner, ry * inner, a0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${ox0} ${oy0} A ${rx} ${ry} 0 ${large} 1 ${ox1} ${oy1} L ${ix1} ${iy1} A ${rx * inner} ${ry * inner} 0 ${large} 0 ${ix0} ${iy0} Z`;
  };

  const sorted = [...segs].sort((a, b) => Math.sin(a.mid) - Math.sin(b.mid));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} role="img">
      <ellipse cx={cx} cy={cy + depth + 22} rx={rx + 14} ry={ry * 0.8} fill="rgba(15,23,42,0.05)" />
      {sorted.map((s) => {
        const span = frontSpan(s.a0, s.a1) ?? frontSpan(s.a0 + TAU, s.a1 + TAU);
        return (
          <g key={`side-${s.name}`}>
            {span && <path d={arcSide(cx, cy, rx, ry, span[0], span[1], depth)} fill={shade(s.color, 0.7)} />}
            {span && (
              <path
                d={arcSide(cx, cy, rx * inner, ry * inner, span[0], span[1], depth)}
                fill={shade(s.color, 0.55)}
              />
            )}
          </g>
        );
      })}
      {segs.map((s) => (
        <path key={s.name} d={annulus({ x: cx, y: cy }, s.a0, s.a1)} fill={s.color} stroke="#fff" strokeWidth={1.5} />
      ))}
      {segs.map((s) => {
        const right = Math.cos(s.mid) >= 0;
        const [ex, ey] = ellipsePoint(cx, cy, rx * 1.02, ry * 1.02, s.mid);
        const tx = right ? W - 96 : 96;
        const ty = ey - 30 + (Math.sin(s.mid) > 0 ? 34 : 0);
        return (
          <g key={`lbl-${s.name}`}>
            <polyline
              points={`${ex},${ey} ${right ? ex + 18 : ex - 18},${ty} ${tx},${ty}`}
              fill="none"
              stroke="rgba(15,23,42,0.25)"
              strokeWidth={1.2}
            />
            <circle cx={ex} cy={ey} r={3} fill={s.color} />
            <text x={tx} y={ty - 5} textAnchor={right ? "start" : "end"} fontSize={11.5} fontWeight={700} fill="currentColor" className="text-foreground">
              {s.name}
            </text>
            <text x={tx} y={ty + 9} textAnchor={right ? "start" : "end"} fontSize={10.5} fill={shade(s.color, 0.85)}>
              {s.value.toLocaleString()}
              {s.caption ? ` · ${s.caption}` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** GitHub-style month heatmap of daily activations. */
export function CalendarHeatmap({
  data,
  height = 260,
}: {
  data: Array<{ day: number; weekday: number; count: number }>;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const cell = 30;
  const gapPx = 6;
  const cols = 7;
  const firstWd = data[0]?.weekday ?? 0;
  const rows = Math.ceil((data.length + firstWd) / cols);
  const W = cols * (cell + gapPx);
  const H = rows * (cell + gapPx) + 22;
  const labels = ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} role="img">
      {labels.map((l, i) => (
        <text key={i} x={i * (cell + gapPx) + cell / 2} y={12} textAnchor="middle" fontSize={10} fill="#94a3b8">
          {l}
        </text>
      ))}
      {data.map((d, i) => {
        const idx = i + firstWd;
        const x = (idx % cols) * (cell + gapPx);
        const y = Math.floor(idx / cols) * (cell + gapPx) + 22;
        const t = d.count / max;
        return (
          <g key={d.day}>
            <title>{`Day ${d.day}: ${d.count} activations`}</title>
            <rect
              x={x}
              y={y}
              width={cell}
              height={cell}
              rx={8}
              fill={d.count ? "#6366f1" : "rgba(15,23,42,0.05)"}
              fillOpacity={d.count ? 0.2 + t * 0.8 : 1}
            />
            <text x={x + cell / 2} y={y + cell / 2 + 3.5} textAnchor="middle" fontSize={10} fontWeight={600}
              fill={t > 0.55 ? "#fff" : "currentColor"} className={t > 0.55 ? "" : "text-slate-600"}>
              {d.day}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Semicircular gauge: month-to-date pace projected to month end vs a target. */
export function PaceGauge({
  value,
  projected,
  target,
  height = 260,
  label = "projected month end",
}: {
  value: number;
  projected: number;
  target: number;
  height?: number;
  label?: string;
}) {
  const W = 340;
  const H = 210;
  const cx = 170;
  const cy = 172;
  const r = 128;
  const max = Math.max(target, projected, 1) * 1.12;
  const pct = Math.min(1, projected / max);
  const arc = (from: number, to: number) => {
    const a0 = Math.PI + Math.PI * from;
    const a1 = Math.PI + Math.PI * to;
    const [x0, y0] = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
    const [x1, y1] = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
    return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const tAngle = Math.PI + Math.PI * Math.min(1, target / max);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} role="img">
      <defs>
        <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="55%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <path d={arc(0, 1)} fill="none" stroke="rgba(15,23,42,0.08)" strokeWidth={22} strokeLinecap="round" />
      <path d={arc(0, pct)} fill="none" stroke="url(#gaugeGrad)" strokeWidth={22} strokeLinecap="round" />
      <line
        x1={cx + (r - 18) * Math.cos(tAngle)}
        y1={cy + (r - 18) * Math.sin(tAngle)}
        x2={cx + (r + 18) * Math.cos(tAngle)}
        y2={cy + (r + 18) * Math.sin(tAngle)}
        stroke="currentColor"
        className="text-foreground"
        strokeWidth={2.5}
      />
      <text x={cx} y={cy - 42} textAnchor="middle" fontSize={34} fontWeight={800} fill="currentColor" className="text-foreground">
        {Math.round(projected).toLocaleString()}
      </text>
      <text x={cx} y={cy - 22} textAnchor="middle" fontSize={11} fill="currentColor" className="text-muted-foreground">
        {label}
      </text>
      <text x={cx} y={cy + 2} textAnchor="middle" fontSize={11} fill="currentColor" className="text-slate-600">
        {value.toLocaleString()} so far · last month {target.toLocaleString()}
      </text>
    </svg>
  );
}
