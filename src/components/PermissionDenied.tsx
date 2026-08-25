import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { usePermissions, requiredRoleLabel } from "@/lib/permissions";

type Props = {
  title?: string;
  /** What the user was trying to do, e.g. "manage members". */
  action?: string;
  /** Minimum role required for the action. */
  requires?: "owner" | "admin" | "manager";
  backTo?: string;
  backLabel?: string;
};

/**
 * Friendly, non-scary "you don't have permission" screen for use in place
 * of a page body when the current member's role is insufficient.
 */
export function PermissionDenied({
  title = "You don't have access to this page",
  action,
  requires = "admin",
  backTo = "/dashboard",
  backLabel = "Back to dashboard",
}: Props) {
  const { roleLabel } = usePermissions();
  return (
    <div className="p-6 md:p-10 max-w-xl mx-auto">
      <Card className="p-6 md:p-8 text-center space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 grid place-items-center">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {action ? `To ${action}, you need to be ` : "This area requires "}
            <span className="font-medium text-foreground">{requiredRoleLabel(requires)}</span>
            {" "}in this workspace. You're signed in as{" "}
            <span className="font-medium text-foreground">{roleLabel}</span>.
          </p>
          <p className="text-xs text-muted-foreground pt-1">
            Ask a workspace owner or admin if you need this access.
          </p>
        </div>
        <div className="pt-2">
          <Button asChild size="sm" variant="outline">
            <Link to={backTo}>{backLabel}</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
