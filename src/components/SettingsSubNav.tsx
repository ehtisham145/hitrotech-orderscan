import { Link, useRouterState } from "@tanstack/react-router";
import { Settings, Users, CreditCard, Briefcase, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/WorkspaceContext";

type Item = { to: string; label: string; icon: typeof Settings; adminOnly?: boolean };

const ITEMS: Item[] = [
  { to: "/admin/settings", label: "General", icon: Settings },
  { to: "/admin/users", label: "Members", icon: Users, adminOnly: true },
  { to: "/admin/billing", label: "Billing & Plan", icon: CreditCard, adminOnly: true },
  { to: "/admin/workspace", label: "Workspace", icon: Briefcase, adminOnly: true },
  { to: "/admin/audit", label: "Activity", icon: History },
];

export function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { workspace } = useWorkspace();
  const role = workspace?.role ?? null;
  const isAdmin = role === "owner" || role === "admin";
  const items = ITEMS.filter((i) => !i.adminOnly || isAdmin);

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] md:min-h-screen">
      <aside className="w-56 shrink-0 border-r border-border/60 bg-background/60 backdrop-blur-sm hidden md:block sticky top-0 h-screen">
        <div className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Settings</div>
          <nav className="space-y-0.5">
            {items.map((i) => {
              const Icon = i.icon;
              const active = pathname === i.to || pathname.startsWith(i.to + "/");
              return (
                <Link
                  key={i.to}
                  to={i.to}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-2xl px-3 py-2 text-sm font-medium transition-all",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-0 top-1.5 bottom-1.5 w-1 rounded-2xl transition-all",
                      active ? "bg-primary" : "bg-transparent",
                    )}
                  />
                  <Icon className={cn("w-4 h-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                  <span className="truncate">{i.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Mobile horizontal scroller */}
      <div className="md:hidden border-b border-border/60 bg-background/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex gap-1 px-3 py-2 overflow-x-auto">
          {items.map((i) => {
            const Icon = i.icon;
            const active = pathname === i.to || pathname.startsWith(i.to + "/");
            return (
              <Link
                key={i.to}
                to={i.to}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-medium whitespace-nowrap transition-colors",
                  active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {i.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// Backward-compat: existing pages wrap with <SettingsSubNav /> as first sibling.
// Keep export as no-op; layout is now provided by SettingsLayout.
export function SettingsSubNav() {
  return null;
}
