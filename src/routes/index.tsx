import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/ext-client";

export const Route = createFileRoute("/")({
  ssr: false,
  component: IndexRedirect,
});

function IndexRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({ to: "/auth", replace: true });
        return;
      }
      const uid = data.session.user.id;
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      const rs = (roles ?? []).map((r) => r.role as string);
      if (rs.includes("super_admin")) { navigate({ to: "/superadmin", replace: true }); return; }
      const { data: prof } = await supabase.from("profiles").select("active_workspace_id").eq("id", uid).maybeSingle();
      if (prof?.active_workspace_id) {
        const { data: mem } = await supabase.from("workspace_members").select("role").eq("user_id", uid).eq("workspace_id", prof.active_workspace_id).maybeSingle();
        if (mem?.role === "partner") { navigate({ to: "/portal", replace: true }); return; }
      }
      navigate({ to: "/dashboard", replace: true });
    })();
  }, [navigate]);
  return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading…</div>;
}
