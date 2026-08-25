import { Link } from "@tanstack/react-router";
import { AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspaceOptional } from "@/components/WorkspaceContext";

const DAY_MS = 86_400_000;

/** Shows a renewal nudge when the paid plan expires within 3 days (or has lapsed). */
export function PlanExpiryBanner() {
  const ctx = useWorkspaceOptional();
  const ws = ctx?.workspace;
  if (!ws || !ws.plan_expires_at) return null;
  if (ws.plan_tier === "free" || ws.plan_tier === "enterprise") return null;

  const expiresAt = new Date(ws.plan_expires_at);
  if (Number.isNaN(expiresAt.getTime())) return null;

  const msLeft = expiresAt.getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / DAY_MS);
  if (daysLeft > 3) return null;

  const expired = msLeft <= 0;
  const label = expired
    ? "Your plan has expired — your workspace is now on the Free plan."
    : daysLeft <= 1
      ? "Your plan expires today. Renew now to avoid losing paid features."
      : `Your plan expires in ${daysLeft} days. Renew now to keep your paid features.`;

  return (
    <div
      role="status"
      className={
        expired
          ? "flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-destructive/20 bg-destructive/5 text-destructive"
          : "flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-amber-500/20 bg-amber-500/5 text-amber-700"
      }
    >
      {expired ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <Clock className="w-4 h-4 shrink-0" />}
      <span className="text-sm font-medium">{label}</span>
      <Button asChild size="sm" variant={expired ? "destructive" : "default"} className="ml-auto">
        <Link to="/onboarding/plan">Renew now</Link>
      </Button>
    </div>
  );
}
