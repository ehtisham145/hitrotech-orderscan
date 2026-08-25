import { createFileRoute, redirect, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/ext-client";
import {
  LayoutDashboard,
  FolderKanban,
  LogOut,
  Upload,
  Users,
  FileBarChart,
  Menu,
  X,
  Table2,
  Settings,
  Briefcase,
  
  Handshake,
  Wallet,
  UserCheck2,
  Trophy,
  Store,
  AlertTriangle,
  History,
  User,
  FileText,
  TrendingUp,
  Shield,
  CreditCard,
  Building2,

  Scale,
  Lock,
  ScanLine,
} from "lucide-react";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import logo from "@/assets/hitrotech-logo.png.asset.json";
import brandingAsset from "@/assets/sidebar-branding.png.asset.json";
import { CommandPalette } from "@/components/CommandPalette";
import { WorkspaceProvider, useWorkspace } from "@/components/WorkspaceContext";
import { ROLE_LABELS } from "@/lib/permissions";
import { planAllows, type FeatureKey } from "@/lib/plan-features";

import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { NotificationBell } from "@/components/NotificationBell";
import { PlanExpiryBanner } from "@/components/PlanExpiryBanner";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => (
    <WorkspaceProvider>
      <AuthenticatedLayout />
    </WorkspaceProvider>
  ),
});

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;
  const [mobileOpen, setMobileOpen] = useState(false);
  const { workspace, isSuperAdmin, isImpersonating } = useWorkspace();

  // Shares the cache key with the Settings > Profile card, so saving a new
  // full name immediately refreshes the identity card in the sidebar.
  const { data: me } = useQuery({
    queryKey: ["settings", "me"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return { id: "", email: "", full_name: "" };
      const { data: p } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .eq("id", uid)
        .maybeSingle();
      return { id: uid, email: u.user?.email ?? "", full_name: p?.full_name ?? "" };
    },
  });
  const email = me?.email ?? null;
  const displayName = (me?.full_name || "").trim() || email?.split("@")[0] || "User";

  // Full workspace isolation: while inside another account, plan limits are theirs.
  const planUnlimited = isSuperAdmin && !isImpersonating;

  const role = workspace?.role ?? null;
  const isOwner = role === "owner";
  const isAdmin = isOwner || role === "admin" || isSuperAdmin;
  const isManagerOrAdmin = isAdmin || role === "manager";
  const isPartner = role === "partner";
  const isAccountant = role === "accountant";
  const isOperator = role === "operator";
  const isStaff =
    isOwner || role === "admin" || role === "manager" || role === "employee" || isAccountant || isOperator || isSuperAdmin;
  // Accountants get read-only visibility of every money screen.
  const canSeeFinance = isAdmin || isAccountant;
  const canSeePartnerOps = isManagerOrAdmin || isAccountant;


  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; show: boolean; feature?: FeatureKey };
  type NavGroup = { label?: string; badge?: string; items: NavItem[] };

  const tier = workspace?.plan_tier ?? "free";

  const groups: NavGroup[] = [
    {
      label: "Super Admin",
      items: [
        { to: "/superadmin", label: "All Workspaces", icon: Shield, show: isSuperAdmin },
        { to: "/superadmin/billing", label: "Billing Admin", icon: CreditCard, show: isSuperAdmin },
      ],
    },
    {
      label: "Partner Portal",
      items: [
        { to: "/portal", label: "My Dashboard", icon: User, show: isPartner },
        { to: "/portal/statements", label: "My Statements", icon: FileText, show: isPartner },
        { to: "/portal/performance", label: "My Performance", icon: TrendingUp, show: isPartner },
      ],
    },
    {
      label: "Operations",
      items: [
        { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: isStaff },
        { to: "/batches/new", label: "New Import", icon: Upload, show: isStaff },
        { to: "/batches", label: "Batches", icon: FolderKanban, show: isStaff },
        { to: "/orders", label: "All Orders", icon: Table2, show: isStaff },
        { to: "/reports", label: "Reports", icon: FileBarChart, show: isStaff, feature: "reports" },
        { to: "/admin/partners", label: "Partners", icon: Handshake, show: canSeePartnerOps, feature: "partners" },
        { to: "/admin/employees", label: "Employees", icon: Users, show: isStaff, feature: "employees" },
        { to: "/admin/stores", label: "Store Performance", icon: Store, show: canSeePartnerOps, feature: "store_performance" },

      ],
    },
    {
      label: "Performance",
      items: [
        { to: "/admin/leaderboard", label: "Leaderboard", icon: Trophy, show: canSeePartnerOps, feature: "leaderboard" },
        { to: "/admin/anomalies", label: "Anomalies", icon: AlertTriangle, show: isManagerOrAdmin, feature: "anomalies" },
      ],
    },
    {
      label: "Finance",
      items: [

        { to: "/admin/brand", label: "My Brand", icon: Building2, show: canSeeFinance, feature: "brand_earnings" },
        { to: "/admin/commissions", label: "Commissions", icon: Wallet, show: canSeeFinance, feature: "commissions" },
        { to: "/admin/payouts", label: "Payouts", icon: Wallet, show: canSeeFinance || isManagerOrAdmin, feature: "payouts" },
        { to: "/admin/reconciliation", label: "Reconciliation", icon: Scale, show: canSeeFinance, feature: "reconciliation" },
      ],
    },
  ];


  const settingsItem: NavItem = { to: "/admin/settings", label: "Settings", icon: Settings, show: isManagerOrAdmin };
  const allNav = [...groups.flatMap((g) => g.items), settingsItem];


  const initials = displayName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s: string) => s[0]?.toUpperCase())
    .join("");

  const roleLabel = isImpersonating ? "Super Admin · Impersonating" : isSuperAdmin ? "Super Admin" : ROLE_LABELS[role ?? ""] ?? "Member";

  const SidebarInner = (
    <>
      <div className="px-6 py-4 border-b border-border/40">
        <div className="flex items-center justify-center">
          <img src={logo.url} alt="HitroTech Telecom" className="h-10 w-auto object-contain" />
        </div>
      </div>

      <div className="px-4 py-4">
        <WorkspaceSwitcher />
      </div>

      <nav className="flex-1 px-3 py-2 overflow-y-auto space-y-6">
        {(() => {
          const exactRoutes = ["/dashboard", "/batches/new"];
          const isActive = (to: string) =>
            pathname === to ||
            (!exactRoutes.includes(to) &&
              pathname.startsWith(to + "/") &&
              !allNav.some(
                (o) =>
                  o.to !== to &&
                  o.to.startsWith(to + "/") &&
                  (pathname === o.to || pathname.startsWith(o.to + "/"))
              ));

          const renderItem = (n: NavItem) => {
            const Icon = n.icon;
            const active = isActive(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200",
                  active
                    ? "bg-primary/8 text-primary shadow-[0_2px_10px_-3px_rgba(235,89,110,0.15)]"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {active && (
                  <span className="absolute left-0 top-2 bottom-2 w-1 rounded-2xl bg-primary shadow-[0_0_10px_rgba(235,89,110,0.5)]" />
                )}
                <Icon
                  className={cn(
                    "w-[18px] h-[18px] shrink-0 transition-colors",
                    active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                <span className="truncate">{n.label}</span>
                {n.feature && !planUnlimited && !planAllows(tier, n.feature) && (
                  <Lock className="w-3.5 h-3.5 ml-auto shrink-0 text-slate-300" />
                )}
              </Link>
            );
          };

          return (
            <>
              {groups.map((g, gi) => {
                const visible = g.items.filter((i) => i.show);
                if (visible.length === 0) return null;
                return (
                  <div key={gi} className="space-y-1">
                    {g.label && (
                      <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground/80">
                        {g.label}
                      </div>
                    )}
                    <div className="space-y-0.5">{visible.map(renderItem)}</div>
                  </div>
                );
              })}
              <div className="mt-auto pt-4 space-y-1 border-t border-border/40">
                {settingsItem.show && renderItem(settingsItem)}
              </div>
            </>
          );
        })()}
      </nav>

      <div className="p-4 bg-accent/20 border-t border-border/40">
        <div className="flex items-center gap-3 rounded-2xl bg-card p-2.5 mb-3 border border-border/60 shadow-sm">
          <div className="h-9 w-9 rounded-2xl bg-primary text-primary-foreground grid place-items-center text-xs font-bold shadow-sm">
            {initials || "U"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-foreground truncate">
              {displayName}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {roleLabel}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 h-9 text-muted-foreground hover:text-foreground hover:bg-accent font-semibold"
            onClick={signOut}
          >
            <LogOut className="w-4 h-4 mr-2" /> Sign out
          </Button>
          <NotificationBell />
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex w-full">
      <aside className="w-64 shrink-0 border-r border-border/40 bg-sidebar flex-col hidden md:flex sticky top-0 h-screen shadow-[1px_0_10px_rgba(0,0,0,0.02)]">
        {SidebarInner}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-72 bg-sidebar border-r border-border shadow-xl flex flex-col">
            {SidebarInner}
          </aside>
        </div>
      )}

      <main className="flex-1 min-w-0">
        <div className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-3 px-4 h-14 border-b border-border/60 bg-background">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="grid place-items-center h-9 w-9 rounded-2xl border border-border hover:bg-accent"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
          <div className="flex items-center gap-2">
            <img src={logo.url} alt="HitroTech" className="h-7 w-auto object-contain" />
          </div>
          <NotificationBell />
        </div>
        <PlanExpiryBanner />
        <Outlet />

      </main>
      <CommandPalette />
    </div>
  );
}
