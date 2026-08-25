import * as React from "react";

type Item = { name: string; count: number };

/**
 * Semi-circular gauge with a colored fill arc, gray remainder track, and a
 * 3D-looking black needle — inspired by the reference infographic. Renders one
 * gauge per SIM-type category.
 */
function Gauge({ pct, color, label, value }: { pct: number; color: string; label: string; value: number }) {
  const W = 240, H = 170;
  const cx = W / 2, cy = 140;
  const r = 90;
  const stroke = 34;
  // Semi-circle from 180° (left) to 0° (right)
  const angle = Math.max(0, Math.min(100, pct)) / 100; // 0..1
  const theta = Math.PI * (1 - angle); // radians, from left (π) to right (0)

  // Endpoints
  const fillEndX = cx + r * Math.cos(Math.PI - Math.PI * angle);
  const fillEndY = cy - r * Math.sin(Math.PI - Math.PI * angle);
  const leftX = cx - r, rightX = cx + r;
  const largeArc = angle > 0.5 ? 1 : 0;

  const needleLen = r + 6;
  const nx = cx + needleLen * Math.cos(theta);
  const ny = cy - needleLen * Math.sin(theta);
  // Needle base width
  const perpX = Math.sin(theta), perpY = Math.cos(theta);
  const baseHalf = 9;
  const b1x = cx + perpX * baseHalf, b1y = cy + perpY * baseHalf;
  const b2x = cx - perpX * baseHalf, b2y = cy - perpY * baseHalf;

  const uid = React.useId().replace(/:/g, "");

  return (
    <div className="flex flex-col items-center">
      <div className="text-2xl font-bold text-slate-800 mb-1">{pct}%</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[260px]">
        <defs>
          <linearGradient id={`g-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.75" />
          </linearGradient>
          <linearGradient id={`g-track-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e5e7eb" />
            <stop offset="100%" stopColor="#cbd1d9" />
          </linearGradient>
          <linearGradient id={`g-needle-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3f4550" />
            <stop offset="55%" stopColor="#0b0d12" />
            <stop offset="100%" stopColor="#2b303a" />
          </linearGradient>
          <filter id={`g-shadow-${uid}`} x="-20%" y="-20%" width="140%" height="160%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="2.5" />
            <feOffset dy="3" />
            <feComponentTransfer><feFuncA type="linear" slope="0.35" /></feComponentTransfer>
            <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Remainder track (right side of needle) */}
        <path
          d={`M ${fillEndX} ${fillEndY} A ${r} ${r} 0 ${1 - largeArc} 1 ${rightX} ${cy}`}
          stroke={`url(#g-track-${uid})`}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="butt"
        />
        {/* Filled portion (left side up to needle) */}
        <path
          d={`M ${leftX} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${fillEndX} ${fillEndY}`}
          stroke={`url(#g-fill-${uid})`}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="butt"
        />
        {/* Inner subtle highlight on the fill */}
        <path
          d={`M ${leftX} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${fillEndX} ${fillEndY}`}
          stroke="rgba(255,255,255,0.35)"
          strokeWidth={4}
          fill="none"
          transform={`translate(0 -${stroke / 2 - 6})`}
          opacity="0.5"
        />

        {/* Needle */}
        <g filter={`url(#g-shadow-${uid})`}>
          <polygon
            points={`${b1x},${b1y} ${b2x},${b2y} ${nx},${ny}`}
            fill={`url(#g-needle-${uid})`}
          />
          <circle cx={cx} cy={cy} r={8} fill="#0b0d12" />
          <circle cx={cx - 2} cy={cy - 2} r={2.5} fill="#4b5563" />
        </g>
      </svg>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}66` }} />
        <span className="text-slate-700">{label}</span>
        <span className="font-bold text-slate-900">{value}</span>
      </div>
    </div>
  );
}

export function SimGauges({ title, data, palette }: { title: string; data: Item[]; palette: string[] }) {
  const total = data.reduce((a, b) => a + b.count, 0) || 1;
  return (
    <div className="w-full">
      <div className="text-base font-semibold text-slate-800 mb-2">{title}</div>
      <div className={`grid gap-4 ${data.length <= 1 ? "grid-cols-1" : data.length === 2 ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3"}`}>
        {data.map((d, i) => (
          <Gauge
            key={d.name}
            pct={Math.round((d.count / total) * 100)}
            color={palette[i % palette.length]}
            label={d.name}
            value={d.count}
          />
        ))}
      </div>
    </div>
  );
}
