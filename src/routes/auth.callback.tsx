import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/ext-client";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        // After Google login, check roles to decide where to land
        const uid = session.user.id;
        Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", uid),
          supabase.from("profiles").select("active_workspace_id").eq("id", uid).maybeSingle(),
        ]).then(([{ data: roles }, { data: prof }]) => {
          const rs = (roles ?? []).map((r) => r.role as string);
          if (rs.includes("super_admin")) {
            navigate({ to: "/superadmin", replace: true });
            return;
          }
          if (prof?.active_workspace_id) {
            navigate({ to: "/dashboard", replace: true });
          } else {
            navigate({ to: "/onboarding", replace: true });
          }
        });
      } else if (event === "SIGNED_OUT") {
        navigate({ to: "/auth", replace: true });
      }
    });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
        <p className="mt-4 text-sm text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  );
}
