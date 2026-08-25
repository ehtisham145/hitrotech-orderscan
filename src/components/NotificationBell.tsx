import { useEffect, useMemo, useState } from "react";
import { Bell, Check, CheckCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listNotifications, markNotificationRead } from "@/lib/notifications.functions";
import { supabase } from "@/integrations/supabase/ext-client";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

export function NotificationBell() {
  const qc = useQueryClient();
  const listFn = useServerFn(listNotifications);
  const markFn = useServerFn(markNotificationRead);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listFn({ data: { limit: 30 } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Realtime: refresh on new inserts for this user
  useEffect(() => {
    if (!userId) return;
    // Unique channel name per mount avoids re-using a channel that's already
    // subscribed (React StrictMode double-invoke re-registers callbacks after subscribe()).
    const channelName = `notifications:${userId}:${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["notifications"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  const markM = useMutation({
    mutationFn: async (args: { id?: string; all?: boolean }) => markFn({ data: args }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
    onError: (e: any) => toast.error(e.message ?? "Failed to mark as read"),
  });

  const unread = data?.unreadCount ?? 0;
  const notifications = useMemo(() => data?.notifications ?? [], [data]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative grid place-items-center h-9 w-9 rounded-2xl border border-border/60 hover:bg-accent transition-colors"
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold grid place-items-center shadow">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" sideOffset={8}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
          <div className="text-sm font-semibold">Notifications</div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1"
            disabled={unread === 0 || markM.isPending}
            onClick={() => markM.mutate({ all: true })}
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark all read
          </Button>
        </div>

        <ScrollArea className="max-h-96">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
              You're all caught up.
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {notifications.map((n) => {
                const isUnread = !n.read_at;
                return (
                  <li
                    key={n.id}
                    className={cn(
                      "group flex items-start gap-2 px-3 py-3 hover:bg-accent/60 transition-colors",
                      isUnread && "bg-primary/[0.04]",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 rounded-full shrink-0",
                        isUnread ? "bg-primary" : "bg-transparent",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{n.title}</div>
                      {n.body && (
                        <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</div>
                      )}
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1 flex items-center gap-1.5">
                        {n.workspace_name && <span>{n.workspace_name}</span>}
                        {n.workspace_name && <span aria-hidden>•</span>}
                        <span>{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span>
                      </div>
                    </div>
                    {isUnread && (
                      <button
                        type="button"
                        title="Mark as read"
                        disabled={markM.isPending}
                        onClick={() => markM.mutate({ id: n.id })}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 h-7 w-7 grid place-items-center rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
        <div className="border-t border-border/60 p-2">
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block text-center text-xs font-medium text-primary hover:underline py-1"
          >
            View all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

