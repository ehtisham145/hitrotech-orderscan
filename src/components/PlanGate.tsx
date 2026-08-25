import { Link } from "@tanstack/react-router";
import { Lock, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/WorkspaceContext";
import { planAllows, minTierFor, isPlanActive, FEATURE_LABEL, type FeatureKey } from "@/lib/plan-features";
import { getPlan } from "@/lib/plans";
import type { ReactNode } from "react";

type Props = {
  feature: FeatureKey;
  children: ReactNode;
  /** Optional custom title to override "<Feature> is a <Plan> feature". */
  title?: string;
};

export function PlanGate({ feature, children, title }: Props) {
  const { workspace, loading, isSuperAdmin, isImpersonating } = useWorkspace();

  if (loading) return null;
  if (!workspace) return <>{children}</>;
  if (isSuperAdmin && !isImpersonating) return <>{children}</>;


  const tier = workspace.plan_tier;
  const expired = !isPlanActive(tier, workspace.plan_expires_at);
  const allowed = planAllows(tier, feature) && !expired;

  if (allowed) return <>{children}</>;

  const required = minTierFor(feature);
  const requiredPlan = getPlan(required);
  const featureLabel = FEATURE_LABEL[feature];

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      <Card className="p-8 text-center space-y-5">
        <div className="mx-auto h-14 w-14 rounded-xl gradient-brand text-primary-foreground grid place-items-center">
          {expired ? <Lock className="w-7 h-7" /> : <Sparkles className="w-7 h-7" />}
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {title ?? (expired ? `Your plan has expired` : `${featureLabel} is a ${requiredPlan.name} feature`)}
          </h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {expired
              ? `Renew or upgrade to keep using ${featureLabel} and other paid features.`
              : `Your workspace is currently on the ${getPlan(tier).name} plan. Upgrade to ${requiredPlan.name} to unlock ${featureLabel}.`}
          </p>
        </div>
        <div className="flex justify-center gap-2">
          <Button asChild>
            <Link to="/admin/billing">
              {expired ? "Renew plan" : `Upgrade to ${requiredPlan.name}`}
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
