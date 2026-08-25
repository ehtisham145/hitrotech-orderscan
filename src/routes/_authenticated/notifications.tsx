import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listNotificationsPage, markNotificationRead } from "@/lib/notifications.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, Check, CheckCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/EmptyState";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — HitroTech OrderScan" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NotificationsPage,
});

const PAGE_SIZE = 20;

function NotificationsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listNotificationsPage);
  const markFn = useServerFn(markNotificationRead);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["notifications-page", filter, page],
    queryFn: () => listFn({ data: { filter, offset: page * PAGE_SIZE, limit: PAGE_SIZE } }),
  });

  const markM = useMutation({
    mutationFn: async (args: { id?: string; all?: boolean }) => markFn({ data: args }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-page"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const total = data?.total ?? 0;
  const notifications = useMemo(() => data?.notifications ?? [], [data]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasAnyUnread = notifications.some((n) => !n.read_at);

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">Everything that's happened in your workspace.</p>
        </div>
        <div className="flex gap-2">
          {(["all", "unread"] as const).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={filter === k ? "default" : "outline"}
              onClick={() => { setFilter(k); setPage(0); }}
            >
              {k === "all" ? "All" : "Unread"}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={!hasAnyUnread || markM.isPending}
            onClick={() => markM.mutate({ all: true })}
          >
            <CheckCheck className="w-3.5 h-3.5" /> Mark all read
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {total} {filter === "unread" ? "unread" : "total"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : notifications.length === 0 ? (
            <EmptyState
              icon={Bell}
              title={filter === "unread" ? "No unread notifications" : "No notifications yet"}
              description="Activity in your workspace will show up here."
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {notifications.map((n) => {
                const unread = !n.read_at;
                return (
                  <li
                    key={n.id}
                    className={cn(
                      "group flex items-start gap-3 py-3",
                      unread && "bg-primary/[0.03] -mx-4 px-4 rounded-md",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 rounded-full shrink-0",
                        unread ? "bg-primary" : "bg-transparent",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{n.title}</div>
                      {n.body && <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>}
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                        {n.workspace_name && <span>{n.workspace_name}</span>}
                        {n.actor_name && <><span aria-hidden>•</span><span>by {n.actor_name}</span></>}
                        <span aria-hidden>•</span>
                        <span title={format(new Date(n.created_at), "PPpp")}>
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                    {unread && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                        disabled={markM.isPending}
                        onClick={() => markM.mutate({ id: n.id })}
                      >
                        <Check className="w-3.5 h-3.5" /> Mark read
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Prev
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
              Next <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
