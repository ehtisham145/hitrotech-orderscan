import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ConfirmDialogProvider } from "@/components/ConfirmDialog";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "OrderScan AI — Telecom Order Screenshot Extractor" },
      { name: "description", content: "Extract structured data from telecom order screenshots with AI. Upload batches, detect duplicates, export to Excel." },
      { property: "og:title", content: "OrderScan AI — Telecom Order Screenshot Extractor" },
      { property: "og:description", content: "Extract structured data from telecom order screenshots with AI. Upload batches, detect duplicates, export to Excel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "OrderScan AI — Telecom Order Screenshot Extractor" },
      { name: "twitter:description", content: "Extract structured data from telecom order screenshots with AI. Upload batches, detect duplicates, export to Excel." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1cb9999d-7dd5-4723-a940-a5163b25aef9/id-preview-13892bb6--9d09e890-b92a-49f8-be93-3f8643dab839.lovable.app-1783598055184.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1cb9999d-7dd5-4723-a940-a5163b25aef9/id-preview-13892bb6--9d09e890-b92a-49f8-be93-3f8643dab839.lovable.app-1783598055184.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=DM+Sans:wght@400;500;600;700&family=Orbitron:wght@500;700;800&display=swap",
      },
      { rel: "icon", href: "/hitrotech-logo.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  // Apply persisted theme + density on every load
  useEffect(() => {
    try {
      const theme = (localStorage.getItem("orderscan.theme") as "light" | "dark" | "system" | null) || "system";
      const density = localStorage.getItem("orderscan.density") || "comfortable";
      const resolved = theme === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : theme;
      document.documentElement.classList.toggle("dark", resolved === "dark");
      document.documentElement.setAttribute("data-density", density);
    } catch { /* ignore */ }
  }, []);
  // Sentry + PostHog (browser only)
  useEffect(() => {
    import("@/lib/observability").then((m) => m.initObservability());
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    Promise.all([
      import("@/integrations/supabase/ext-client"),
      import("@/lib/observability"),
    ]).then(([{ supabase }, obs]) => {
      supabase.auth.getUser().then(({ data }) => {
        if (data.user) obs.identifyUser(data.user.id, { email: data.user.email });
      });
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
        if (event === "SIGNED_OUT") obs.resetUser();
        else if (session?.user) obs.identifyUser(session.user.id, { email: session.user.email });
        router.invalidate();
        if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
      });
      unsub = () => data.subscription.unsubscribe();
    });
    return () => unsub?.();
  }, [router, queryClient]);


  // Realtime toast when a batch finishes processing. Purely informational —
  // no workflow changes; the batch state transition itself happens server-side.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const [{ supabase }, { toast }] = await Promise.all([
        import("@/integrations/supabase/ext-client"),
        import("sonner"),
      ]);
      const { data: sess } = await supabase.auth.getSession();
      if (cancelled || !sess.session) return;
      const channel = supabase
        .channel("batches-completion")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "batches" },
          (payload) => {
            const oldRow = payload.old as { status?: string } | null;
            const newRow = payload.new as { id?: string; name?: string; status?: string } | null;
            if (!newRow || !oldRow) return;
            if (oldRow.status === newRow.status) return;
            if (newRow.status === "completed") {
              toast.success(`Batch completed: ${newRow.name ?? "Untitled"}`, {
                id: newRow.id ? `batch-completed-${newRow.id}` : undefined,
                action: newRow.id
                  ? { label: "Open", onClick: () => router.navigate({ to: "/batches/$id", params: { id: newRow.id! } }) }
                  : undefined,
              });
              queryClient.invalidateQueries({ queryKey: ["batches"] });
            } else if (newRow.status === "failed") {
              toast.error(`Batch failed: ${newRow.name ?? "Untitled"}`, {
                id: newRow.id ? `batch-failed-${newRow.id}` : undefined,
              });
              queryClient.invalidateQueries({ queryKey: ["batches"] });
            }
          },
        )
        .subscribe();
      cleanup = () => { void supabase.removeChannel(channel); };
    })();
    return () => { cancelled = true; cleanup?.(); };
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <ToasterLazy />
      <ConfirmDialogProvider />
    </QueryClientProvider>
  );
}

function ToasterLazy() {
  const [T, setT] = useState<React.ComponentType | null>(null);
  useEffect(() => {
    import("@/components/ui/sonner").then((m) => setT(() => m.Toaster));
  }, []);
  return T ? <T /> : null;
}
