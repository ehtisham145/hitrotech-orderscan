// Shared chart theme, palettes, gradient defs, and tooltip primitives
// used by the dashboard chart components. Extracted from dashboard.tsx.
import * as React from "react";

// Neon chart palette — vivid dark-mode hues designed to glow on a dark card.
// Extractions statuses — dedicated teal/slate family, disjoint from every
// category palette below so status colors never collide with SIM, Number,
// Networks, Branches, Stores, Packages, or Employees hues.
export const CHART = {
  success:    "#10b981", // emerald — vivid green
  failed:     "#ef4444", // vivid red
  duplicates: "#f59e0b", // amber — high contrast against success green
  review:     "#64748b", // slate
  primary:    "#6366f1", // indigo — reserved for OCR trend
  grid: "rgba(15,23,42,0.08)",
  axis: "rgba(15,23,42,0.55)",
};
// Neon categorical palette — saturated, high-contrast, dark-mode-friendly.
export const CATEGORICAL = [
  "#a855f7", "#ec4899", "#22d3ee", "#f97316",
  "#3b82f6", "#22c55e", "#fbbf24", "#f43f5e",
];
// Per-chart palettes — each chart gets its OWN color family so no two
// categories ever share a hue. Networks keeps carrier-brand colors.
export const PALETTES = {
  simType:    ["#a855f7", "#8b5cf6", "#c084fc", "#7c3aed", "#6d28d9", "#ddd6fe"], // violet
  numberType: ["#8b5cf6", "#22d3ee", "#f59e0b", "#10b981", "#ef4444", "#6366f1"], // vibrant multi-hue
  paidVia:    ["#f97316", "#fb923c", "#ea580c", "#fbbf24", "#f59e0b", "#fdba74"], // orange/amber
  networks:   ["#22d3ee", "#06b6d4", "#0891b2", "#67e8f9", "#0e7490", "#a5f3fc"], // cyan (fallback only — brand colors override)
  branches:   ["#ef4444", "#dc2626", "#f87171", "#b91c1c", "#fca5a5", "#991b1b"], // red
  stores:     ["#22c55e", "#10b981", "#16a34a", "#34d399", "#059669", "#86efac"], // green/emerald
  packages:   ["#3b82f6", "#2563eb", "#60a5fa", "#1d4ed8", "#93c5fd", "#1e40af"], // blue
  employees:  ["#eab308", "#facc15", "#ca8a04", "#fde047", "#a16207", "#fef08a"], // yellow/gold
};
export const BAR_PALETTE = CATEGORICAL;
export const PIE_PALETTE = CATEGORICAL;

// Pakistan telecom brand colors — kept for "Top networks" so carriers stay recognizable.
export const NETWORK_BRAND_COLORS: Record<string, string> = {
  jazz:     "#ff2d55",
  onic:     "#c084fc",
  ufone:    "#ff8a3d",
  zong:     "#22c55e",
  telenor:  "#22d3ee",
  scom:     "#3b82f6",
  warid:    "#ec4899",
  mobilink: "#fbbf24",
};
export const brandColorFor = (name: string, fallback: string) => {
  const key = (name ?? "").trim().toLowerCase();
  return NETWORK_BRAND_COLORS[key] ?? fallback;
};

// --- Neon gradient defs + glow filter -------------------------------------
// For each color we build a vertical 2-stop gradient going from a hue-rotated
// partner tone at the bottom to the base color at the top — the "photon bar"
// look from the reference.
export function hexToHsl(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hh = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hh = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hh = (b - r) / d + 2; break;
      case b: hh = (r - g) / d + 4; break;
    }
    hh *= 60;
  }
  return [hh, s * 100, l * 100];
}
export function hslToHex(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
export function shiftHue(hex: string, deg: number, lightBoost = 0) {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex((h + deg + 360) % 360, Math.min(100, s + 5), Math.min(85, l + lightBoost));
}

export const ALL_GRADIENT_COLORS = Array.from(new Set<string>([
  CHART.success, CHART.failed, CHART.duplicates, CHART.review, CHART.primary,
  ...CATEGORICAL,
  ...Object.values(PALETTES).flat(),
  ...Object.values(NETWORK_BRAND_COLORS),
]));
export const gradFor = (c: string) => `url(#g-${c.replace("#", "")})`;
export function ChartGradientDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        {ALL_GRADIENT_COLORS.map((c) => {
          const partner = shiftHue(c, 40, 8);
          return (
            <linearGradient key={c} id={`g-${c.replace("#", "")}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={partner} stopOpacity={0.85} />
              <stop offset="55%" stopColor={c} stopOpacity={1} />
              <stop offset="100%" stopColor={shiftHue(c, -25, 15)} stopOpacity={1} />
            </linearGradient>
          );
        })}
        <filter id="neon-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

export const NEON_CARD =
  "relative overflow-hidden border border-slate-200/60 bg-white text-foreground shadow-sm rounded-2xl [&_.recharts-cartesian-axis-tick_text]:fill-slate-400 [&_.recharts-legend-item-text]:!text-slate-600 [&_.recharts-polar-angle-axis-tick_text]:fill-slate-400 [&_.recharts-polar-radius-axis-tick_text]:fill-slate-400 [&_.recharts-text]:fill-slate-400";

export const NEON_TOOLTIP = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  color: "var(--foreground)",
  fontSize: 12,
  borderRadius: 0,
  boxShadow: "var(--shadow-lg)",
} as const;
export const NEON_TOOLTIP_ITEM = { color: "var(--foreground)" } as const;
export const NEON_TOOLTIP_LABEL = { color: "var(--muted-foreground)", fontWeight: 600 } as const;
export const NEON_FILTER = { } as const;

// Rich tooltip: colored dot, name, count, and (when total given) percentage.
export function RichTooltip(_: { active?: boolean; payload?: Array<{ name?: string; value?: number; payload?: { name?: string; count?: number; fill?: string }; color?: string }>; total?: number }) {
  return null;
}

export type CatProps = { title: string; data: { name: string; count: number }[]; offset?: number; palette?: string[] };
