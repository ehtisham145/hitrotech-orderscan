import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Gauge, Sparkles } from "lucide-react";
import { getActivationUsage } from "@/lib/usage.functions";

export function ActivationUsageCard() {
  const fetchUsage = useServerFn(getActivationUsage);
  const { data } = useQuery({
    queryKey: ["activation-usage"],
    queryFn: () => fetchUsage(),
    staleTime: 30_000,
  });

  if (!data) return null;
  const { used, limit, planName, planTier, periodEnd } = data;
  const resetLabel = periodEnd
    ? new Date(periodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  // Unlimited plan → compact info card, no bar
  if (limit === null) {
    return (
    <Card className="rounded-2xl border-slate-200/60 shadow-sm">

        <CardContent className="pt-5 pb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-primary/10 text-primary grid place-items-center">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold">{used.toLocaleString()} activations this month</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500/80">{planName} — unlimited</div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const isNear = pct >= 80 && pct < 100;
  const isOver = used >= limit;
  const barTone = isOver ? "bg-destructive" : isNear ? "bg-amber-500" : "bg-emerald-500";

  return (
    <Card className="rounded-2xl border-slate-200/60 shadow-sm">
      <CardContent className="pt-5 pb-5 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-2xl grid place-items-center ${isOver ? "bg-destructive/10 text-destructive" : isNear ? "bg-amber-500/10 text-amber-600" : "bg-emerald-500/10 text-emerald-600"}`}>
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold">
                {used.toLocaleString()} / {limit.toLocaleString()} activations this period
              </div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500/80">
                {planName} plan{resetLabel ? ` — resets ${resetLabel}` : ""}
              </div>
            </div>
          </div>
          {(isNear || isOver) && planTier !== "enterprise" && (
            <Button asChild size="sm" variant={isOver ? "destructive" : "default"} className="rounded-2xl">
              <Link to="/admin/billing">
                <Sparkles className="w-4 h-4 mr-1.5" /> Upgrade
              </Link>
            </Button>
          )}
        </div>
        <div className="h-2 rounded-2xl bg-slate-100 overflow-hidden">
          <div className={`h-full ${barTone} transition-all duration-500 ease-out`} style={{ width: `${pct}%` }} />
        </div>
        {isOver && (
          <p className="text-xs text-destructive">
            You've hit your limit for this 30-day period. New imports are blocked until{resetLabel ? ` ${resetLabel}` : " the next period"} or you upgrade.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
