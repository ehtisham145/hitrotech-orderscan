import * as React from "react";

type Slice = { label: string; value: number; color: string; darkColor?: string };

function pt(cx: number, cy: number, rx: number, ry: number, theta: number) {
  return [cx + rx * Math.sin(theta), cy - ry * Math.cos(theta)] as const;
}

function shade(hex: string, amount: number) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amount < 0 ? v * amount : (255 - v) * amount))));
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Top annular sector between two thetas measured from top (0 = top, CW)
function topFacePath(
  cx: number,
  cy: number,
  orx: number,
  ory: number,
  irx: number,
  iry: number,
  t1: number,
  t2: number,
) {
  const [ox1, oy1] = pt(cx, cy, orx, ory, t1);
  const [ox2, oy2] = pt(cx, cy, orx, ory, t2);
  const [ix1, iy1] = pt(cx, cy, irx, iry, t1);
  const [ix2, iy2] = pt(cx, cy, irx, iry, t2);
  const large = t2 - t1 > Math.PI ? 1 : 0;
  return `M ${ox1} ${oy1} A ${orx} ${ory} 0 ${large} 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${irx} ${iry} 0 ${large} 0 ${ix1} ${iy1} Z`;
}

// Outer wall segment for a portion of theta (assumed within front half [π/2, 3π/2])
function outerWallPath(cx: number, cy: number, rx: number, ry: number, h: number, t1: number, t2: number) {
  const [x1, y1] = pt(cx, cy, rx, ry, t1);
  const [x2, y2] = pt(cx, cy, rx, ry, t2);
  const large = t2 - t1 > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${rx} ${ry} 0 ${large} 1 ${x2} ${y2} L ${x2} ${y2 + h} A ${rx} ${ry} 0 ${large} 0 ${x1} ${y1 + h} Z`;
}

// Radial (side) wall connecting outer edge to inner edge at a given theta, extruded by h
function radialWallPath(
  cx: number,
  cy: number,
  orx: number,
  ory: number,
  irx: number,
  iry: number,
  h: number,
  t: number,
) {
  const [ox, oy] = pt(cx, cy, orx, ory, t);
  const [ix, iy] = pt(cx, cy, irx, iry, t);
  return `M ${ox} ${oy} L ${ix} ${iy} L ${ix} ${iy + h} L ${ox} ${oy + h} Z`;
}

// Clip [a,b] to [lo,hi]; return null if empty
function clip(a: number, b: number, lo: number, hi: number): [number, number] | null {
  const s = Math.max(a, lo);
  const e = Math.min(b, hi);
  if (e <= s) return null;
  return [s, e];
}

export function IsoDonut3D({
  slices,
  totalLabel = "Total",
}: {
  slices: Slice[];
  totalLabel?: string;
}) {
  const total = slices.reduce((a, b) => a + b.value, 0) || 1;
  const cx = 175;
  const cy = 130;
  const orx = 135;
  const ory = 62;
  const irx = 48;
  const iry = 22;
  const h = 46;

  // Build slices with theta ranges going CW starting from top (theta=0)
  let acc = 0;
  const built = slices.map((s) => {
    const frac = s.value / total;
    const t1 = acc * Math.PI * 2;
    const t2 = (acc + frac) * Math.PI * 2;
    acc += frac;
    return {
      ...s,
      t1,
      t2,
      pct: Math.round(frac * 100),
      mid: (t1 + t2) / 2,
      darkColor: s.darkColor ?? shade(s.color, -0.28),
    };
  });

  // Sort slices for painter's algorithm: farther (back) drawn first.
  // Depth of a slice ≈ -cos(midTheta). Small mid (near 0) = back, near π = front.
  const sortedByDepth = [...built].sort((a, b) => Math.cos(a.mid) - Math.cos(b.mid)); // back (cos=1) first

  // Front-wall segments per slice, clipped to [π/2, 3π/2]
  const frontWallSegs = built.flatMap((s) => {
    const seg = clip(s.t1, s.t2, Math.PI / 2, (3 * Math.PI) / 2);
    return seg ? [{ ...s, segT1: seg[0], segT2: seg[1] }] : [];
  });
  // Painter sort: draw more-back first (further from θ=π)
  frontWallSegs.sort((a, b) => {
    const da = Math.min(Math.abs(a.segT1 - Math.PI), Math.abs(a.segT2 - Math.PI));
    const db = Math.min(Math.abs(b.segT1 - Math.PI), Math.abs(b.segT2 - Math.PI));
    return db - da;
  });

  // Radial walls: at each boundary theta between slices, visible if in front half
  const boundaries = built.map((s) => s.t2);
  const radialWalls = boundaries
    .map((t, i) => {
      const norm = ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const inFront = norm > Math.PI / 2 && norm < (3 * Math.PI) / 2;
      // Boundary between slice i and slice i+1 (mod)
      const leftSlice = built[i];
      const rightSlice = built[(i + 1) % built.length];
      // The wall is shared but we tint it darker; pick the slice on the near side
      // Near side = the one whose midpoint's cos(mid) is smaller (closer to front).
      const nearSlice = Math.cos(leftSlice.mid) < Math.cos(rightSlice.mid) ? leftSlice : rightSlice;
      return { t: norm, inFront, color: nearSlice.darkColor };
    })
    .filter((w) => w.inFront);

  // Center cylinder (white) — top ellipse and side rect
  const cylTopY = cy - 8;
  const cylBotY = cy + h - 6;

  return (
    <svg viewBox="0 0 350 260" className="w-full h-full max-h-[280px]">
      <defs>
        {built.map((s, i) => (
          <linearGradient key={i} id={`iso-top-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={shade(s.color, 0.15)} />
            <stop offset="100%" stopColor={s.color} />
          </linearGradient>
        ))}
        {built.map((s, i) => (
          <linearGradient key={`w-${i}`} id={`iso-wall-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} />
            <stop offset="100%" stopColor={shade(s.color, -0.35)} />
          </linearGradient>
        ))}
        <linearGradient id="iso-cyl" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#e6e8ee" />
          <stop offset="45%" stopColor="#fafbfc" />
          <stop offset="100%" stopColor="#c8ccd4" />
        </linearGradient>
        <radialGradient id="iso-cyl-top" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#d8dce4" />
        </radialGradient>
        <filter id="iso-shadow" x="-20%" y="-20%" width="140%" height="160%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* Ground shadow */}
      <ellipse cx={cx + 6} cy={cy + h + 14} rx={orx * 0.95} ry={ory * 0.6} fill="#0f172a" opacity="0.10" filter="url(#iso-shadow)" />

      {/* Center cylinder side */}
      <rect x={cx - irx} y={cylTopY} width={irx * 2} height={cylBotY - cylTopY} fill="url(#iso-cyl)" />
      {/* Cylinder bottom rim ellipse */}
      <ellipse cx={cx} cy={cylBotY} rx={irx} ry={iry} fill="#c8ccd4" />

      {/* Outer walls: draw farthest first */}
      {frontWallSegs.map((s, i) => (
        <path key={`fw-${i}`} d={outerWallPath(cx, cy, orx, ory, h, s.segT1, s.segT2)} fill={`url(#iso-wall-${built.indexOf(s)})`} />
      ))}

      {/* Radial walls (visible ones) */}
      {radialWalls.map((w, i) => (
        <path key={`rw-${i}`} d={radialWallPath(cx, cy, orx, ory, irx, iry, h, w.t)} fill={w.color} opacity="0.85" />
      ))}

      {/* Top faces — draw back slices first so front ones overlap cleanly */}
      {sortedByDepth.map((s) => {
        const idx = built.indexOf(s);
        return (
          <path
            key={`tf-${idx}`}
            d={topFacePath(cx, cy, orx, ory, irx, iry, s.t1, s.t2)}
            fill={`url(#iso-top-${idx})`}
            stroke="rgba(15,23,42,0.10)"
            strokeWidth="0.6"
          />
        );
      })}

      {/* Center cylinder top ellipse (drawn after top faces so cylinder sits inside hole) */}
      <ellipse cx={cx} cy={cylTopY} rx={irx} ry={iry} fill="url(#iso-cyl-top)" stroke="rgba(15,23,42,0.08)" strokeWidth="0.5" />

      {/* Percentage labels */}
      {built.map((s, i) => {
        if (s.pct < 4) return null;
        const midR_x = (orx + irx) / 2;
        const midR_y = (ory + iry) / 2;
        const [lx, ly] = pt(cx, cy, midR_x, midR_y, s.mid);
        // Rotation aligned with the slice's tangent, but keep readable
        const deg = (s.mid * 180) / Math.PI;
        // Skew for isometric feel
        const rot = deg > 180 ? deg - 180 : deg;
        return (
          <g key={`lbl-${i}`} transform={`translate(${lx} ${ly}) rotate(${rot - 90})`}>
            <text
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#ffffff"
              fontSize="15"
              fontWeight={800}
              style={{ paintOrder: "stroke", stroke: "rgba(15,23,42,0.35)", strokeWidth: 0.6 }}
            >
              {s.pct}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}
