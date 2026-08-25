import * as React from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Consistent empty-state visual for tables, cards, and lists.
 * Keep copy short, action-focused, and non-blaming.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  action?: { label: string; to?: string; onClick?: () => void; disabled?: boolean };
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "px-6 py-8" : "px-6 py-14",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-6 w-6" />
        </div>
      ) : null}
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description ? (
        <div className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</div>
      ) : null}
      {action ? (
        <div className="mt-4">
          {action.to ? (
            <Button asChild size="sm" disabled={action.disabled}>
              <Link to={action.to}>{action.label}</Link>
            </Button>
          ) : (
            <Button size="sm" onClick={action.onClick} disabled={action.disabled}>
              {action.label}
            </Button>

          )}
        </div>
      ) : null}
    </div>
  );
}
