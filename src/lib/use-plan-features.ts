import { useWorkspaceOptional } from "@/components/WorkspaceContext";
import { planAllows, isPlanActive, type FeatureKey } from "@/lib/plan-features";
import type { PlanTier } from "@/lib/plans";

/**
 * Returns `can(feature)` for the current workspace plan.
 * Super admins and workspaces still loading get full access.
 */
export function usePlanFeatures(overrideTier?: PlanTier) {
  const ctx = useWorkspaceOptional();
  const { workspace, loading, isSuperAdmin, isImpersonating } =
    ctx ?? { workspace: null, loading: true, isSuperAdmin: false, isImpersonating: false };

  // While impersonating another account, the super admin sees that workspace's
  // plan exactly as its owner would.
  const unlimited = isSuperAdmin && !isImpersonating;

  const can = (feature: FeatureKey): boolean => {
    if (overrideTier) return planAllows(overrideTier, feature);
    if (loading || !workspace || unlimited) return true;
    if (!isPlanActive(workspace.plan_tier, workspace.plan_expires_at)) return false;
    return planAllows(workspace.plan_tier, feature);
  };


  return { can, tier: overrideTier ?? workspace?.plan_tier ?? "free" };
}
