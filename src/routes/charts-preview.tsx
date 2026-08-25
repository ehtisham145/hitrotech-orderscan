import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BusinessKpiChartsView } from "@/components/dashboard/BusinessKpiCharts";

export const Route = createFileRoute("/charts-preview")({
  component: ChartsPreview,
  head: () => ({
    meta: [
      { title: "Business KPI Charts Preview | Activation Analytics" },
      { name: "description", content: "Sample view of the six business KPI charts: activation pace, monthly momentum, channel mix, partner leaderboard, store contribution and volume vs rate." },
      { property: "og:title", content: "Business KPI Charts Preview" },
      { property: "og:description", content: "Preview of activation analytics charts with sample data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const NETWORKS = ["Jazz", "Telenor", "Zong", "Ufone"];

const daily = Array.from({ length: 20 }).map((_, i) => {
  const j = 4 + Math.round(6 * Math.sin(i / 3) + i / 4);
  const t = 3 + Math.round(4 * Math.cos(i / 4) + i / 6);
  const z = 2 + Math.round(3 * Math.sin(i / 2 + 1) + i / 8);
  const u = 1 + Math.round(2 * Math.cos(i / 5 + 2));
  return { label: String(i + 1), Jazz: j, Telenor: t, Zong: z, Ufone: u, count: j + t + z + u };
});
let run = 0;
const dailyWithCum = daily.map((d) => { run += d.count; return { ...d, cumulative: run }; });

const monthly = ["Mar", "Apr", "May", "Jun", "Jul", "Aug"].map((label, i) => {
  const j = 120 + i * 22, t = 90 + i * 14, z = 70 + i * 11, u = 40 + i * 6;
  return { label, Jazz: j, Telenor: t, Zong: z, Ufone: u, count: j + t + z + u, amount: (j + t + z + u) * 780 };
});

const sample = {
  networks: NETWORKS,
  daily: dailyWithCum,
  monthly,
  role_mix: [
    { role: "franchise_owner", count: 210 },
    { role: "retailer", count: 340 },
    { role: "franchise_as_retailer", count: 120 },
    { role: "field_worker", count: 95 },
    { role: "asm", count: 60 },
  ],
  partners: [
    { name: "Ali Traders", count: 182, rate: 750, amount: 136500 },
    { name: "Amjid Mobiles", count: 154, rate: 750, amount: 115500 },
    { name: "Sharif Comm.", count: 131, rate: 700, amount: 91700 },
    { name: "Nadeem Center", count: 118, rate: 700, amount: 82600 },
    { name: "Bilal Telecom", count: 96, rate: 650, amount: 62400 },
    { name: "Rehman Cell", count: 74, rate: 650, amount: 48100 },
    { name: "Zubair Point", count: 58, rate: 600, amount: 34800 },
    { name: "Kashif Mobile", count: 41, rate: 600, amount: 24600 },
  ],
  stores: [
    { name: "FD4001", count: 260, amount: 195000 },
    { name: "FD4002", count: 190, amount: 142500 },
    { name: "FD4004", count: 150, amount: 112500 },
    { name: "FD4007", count: 120, amount: 90000 },
    { name: "FD4011", count: 85, amount: 63750 },
    { name: "FD4015", count: 49, amount: 36750 },
  ],
  network_stats: [
    { name: "Jazz", count: 340, amount: 272000, rate: 800 },
    { name: "Telenor", count: 210, amount: 157500, rate: 750 },
    { name: "Zong", count: 160, amount: 112000, rate: 700 },
    { name: "Ufone", count: 90, amount: 58500, rate: 650 },
  ],
  day_of_month: 20,
  days_in_month: 31,
  quality: { total: 980, success: 854, duplicate: 74, failed: 52, pending: 0 },
  calendar: Array.from({ length: 31 }).map((_, i) => ({
    day: i + 1,
    weekday: (i + 5) % 7,
    count: i < 20 ? Math.max(0, Math.round(18 + 14 * Math.sin(i / 2.4))) : 0,
    amount: 0,
  })),
};


const TIERS = ["free", "starter", "pro"] as const;

function ChartsPreview() {
  const [tier, setTier] = React.useState<(typeof TIERS)[number]>(() => {
    if (typeof window === "undefined") return "free";
    const t = new URLSearchParams(window.location.search).get("tier");
    return (TIERS as readonly string[]).includes(t ?? "") ? (t as (typeof TIERS)[number]) : "free";
  });
  return (
    <main className="min-h-screen bg-background p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Business KPI charts — preview</h1>
          <p className="text-sm text-muted-foreground">Sample data only, so you can see how each plan's dashboard looks.</p>
        </div>
        <div className="flex gap-1 rounded-xl border bg-muted/40 p-1">
          {TIERS.map((t) => (
            <button
              key={t}
              onClick={() => setTier(t)}
              className={
                "h-8 rounded-lg px-3 text-xs font-medium capitalize " +
                (tier === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")
              }
            >
              {t}
            </button>
          ))}
        </div>
      </header>
      <BusinessKpiChartsView key={tier} data={sample} tier={tier} />
    </main>
  );
}

