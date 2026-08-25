import * as React from "react";

type Slice = { label: string; value: number; from: string; to: string };

/**
 * Connected-bubble infographic: a central hub bubble with satellite bubbles
 * connected by thick gradient "pipes", inspired by the reference infographic.
 */
export function ExtractionsBubbles({ slices, total }: { slices: Slice[]; total: number }) {
  const W = 720;
  const H = 380;
  const cx = W / 2;
  const cy = H / 2;
  const hubR = 78;
  const satR = 62;

  const n = Math.max(slices.length, 1);
  // Distribute satellites around the hub. Use fixed positions for up to 4 for a
  // clean 2-top / 2-bottom layout like the reference.
  const layout: Array<{ x: number; y: number; side: "l" | "r" | "tl" | "tr" | "bl" | "br" }> = (() => {
    if (n === 1) return [{ x: cx + 200, y: cy, side: "r" }];
    if (n === 2)
      return [
        { x: cx - 210, y: cy, side: "l" },
        { x: cx + 210, y: cy, side: "r" },
      ];
    if (n === 3)
      return [
        { x: cx - 220, y: cy - 90, side: "tl" },
        { x: cx + 220, y: cy - 90, side: "tr" },
        { x: cx, y: cy + 130, side: "br" },
      ];
    // 4+: two top, two bottom
    return [
      { x: cx - 240, y: cy - 90, side: "tl" },
      { x: cx + 240, y: cy - 90, side: "tr" },
      { x: cx - 180, y: cy + 120, side: "bl" },
      { x: cx + 180, y: cy + 120, side: "br" },
    ];
  })();

  // Build a curved connector between hub edge and satellite edge.
  function connector(x2: number, y2: number) {
    const dx = x2 - cx;
    const dy = y2 - cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const sx = cx + ux * hubR;
    const sy = cy + uy * hubR;
    const ex = x2 - ux * satR;
    const ey = y2 - uy * satR;
    // Perpendicular for a subtle curve
    const px = -uy;
    const py = ux;
    const bend = 24;
    const mx = (sx + ex) / 2 + px * bend;
    const my = (sy + ey) / 2 + py * bend;
    return `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
  }

  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <defs>
        {slices.map((s, i) => (
          <linearGradient key={i} id={`bub-${i}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={s.from} />
            <stop offset="100%" stopColor={s.to} />
          </linearGradient>
        ))}
        <radialGradient id="bub-hub" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#f5f7fb" />
          <stop offset="100%" stopColor="#d9dee8" />
        </radialGradient>
        <radialGradient id="bub-hi" cx="30%" cy="25%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id="bub-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="4" />
          <feOffset dy="3" />
          <feComponentTransfer><feFuncA type="linear" slope="0.25" /></feComponentTransfer>
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Connectors (drawn behind bubbles) */}
      {slices.map((s, i) => {
        const p = layout[i];
        if (!p) return null;
        return (
          <path
            key={`c-${i}`}
            d={connector(p.x, p.y)}
            stroke={`url(#bub-${i})`}
            strokeWidth={22}
            strokeLinecap="round"
            fill="none"
            opacity={0.9}
          />
        );
      })}

      {/* Hub */}
      <g filter="url(#bub-shadow)">
        <circle cx={cx} cy={cy} r={hubR} fill="url(#bub-hub)" stroke="#334155" strokeWidth={3} />
        <circle cx={cx} cy={cy} r={hubR - 2} fill="url(#bub-hi)" />
      </g>
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="14" fontWeight={800} fill="#334155" letterSpacing="2.5">
        TOTAL
      </text>
      <text x={cx} y={cy + 22} textAnchor="middle" fontSize="32" fontWeight={900} fill="#0f172a">
        {total}
      </text>

      {/* Satellites */}
      {slices.map((s, i) => {
        const p = layout[i];
        if (!p) return null;
        return (
          <g key={`s-${i}`} filter="url(#bub-shadow)">
            <circle cx={p.x} cy={p.y} r={satR} fill={`url(#bub-${i})`} stroke="#ffffff" strokeWidth={3} />
            <circle cx={p.x} cy={p.y} r={satR - 2} fill="url(#bub-hi)" />
            <text
              x={p.x}
              y={p.y - 2}
              textAnchor="middle"
              fontSize="24"
              fontWeight={900}
              fill="#ffffff"
              style={{ paintOrder: "stroke", stroke: "rgba(15,23,42,0.3)", strokeWidth: 1 }}
            >
              {s.value}
            </text>
            <text
              x={p.x}
              y={p.y + 22}
              textAnchor="middle"
              fontSize="14"
              fontWeight={800}
              fill="#ffffff"
              opacity={0.98}
              letterSpacing="1.2"
            >
              {pct(s.value)}%
            </text>
            <text
              x={p.x}
              y={p.y + satR + 22}
              textAnchor="middle"
              fontSize="14"
              fontWeight={800}
              fill="#0f172a"
              style={{ textTransform: "uppercase", letterSpacing: "1.8px" }}
            >
              {s.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
