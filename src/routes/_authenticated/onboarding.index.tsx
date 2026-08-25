import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/ext-client";
import { useWorkspace } from "@/components/WorkspaceContext";
import { renameWorkspace } from "@/lib/workspace.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/onboarding/")({
  head: () => ({
    meta: [
      { title: "Welcome — HitroTech OrderScan" },
      { name: "description", content: "Set up your workspace to get started." },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { workspace, loading } = useWorkspace();
  const renameFn = useServerFn(renameWorkspace);
  const [name, setName] = useState("");

  useEffect(() => {
    if (workspace) setName(workspace.name);
  }, [workspace]);

  const isOwner = workspace?.role === "owner";

  const saveM = useMutation({
    mutationFn: async () => {
      if (!workspace) return;
      const trimmed = name.trim();
      if (isOwner && trimmed && trimmed !== workspace.name) {
        await renameFn({ data: { workspaceId: workspace.id, name: trimmed } });
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["active-workspace"] });
      toast.success("You're all set");
      navigate({ to: "/onboarding/plan", replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!workspace) {
    return (
      <div className="p-8 max-w-lg mx-auto text-sm text-muted-foreground">
        You don't belong to a workspace yet. Ask an admin to invite you.
      </div>
    );
  }

  // If they got here via an invite (they're not the owner), just forward on.
  if (!isOwner) {
    return (
      <div className="p-6 md:p-8 max-w-lg mx-auto">
        <Card className="p-6 space-y-4 text-center">
          <div className="mx-auto h-12 w-12 rounded-xl gradient-brand text-primary-foreground grid place-items-center">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Welcome to {workspace.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              You've joined as {workspace.role}. Ready to jump in?
            </p>
          </div>
          <Button onClick={() => navigate({ to: "/dashboard", replace: true })} className="w-full">
            Continue <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-lg mx-auto">
      <Card className="p-6 space-y-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto h-12 w-12 rounded-xl gradient-brand text-primary-foreground grid place-items-center">
            <Sparkles className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-semibold">Name your workspace</h1>
          <p className="text-sm text-muted-foreground">
            This is what your team will see. You can change it later in settings.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ws-name">Workspace name</Label>
          <Input
            id="ws-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoFocus
            placeholder="Acme Telecom"
          />
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => navigate({ to: "/dashboard", replace: true })}
            disabled={saveM.isPending}
          >
            Skip for now
          </Button>
          <Button
            onClick={() => saveM.mutate()}
            disabled={saveM.isPending || !name.trim()}
          >
            {saveM.isPending ? "Saving…" : "Continue"}
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
