import { createFileRoute } from "@tanstack/react-router";

// Liveness check for the ops/ Docker healthcheck and load balancers. No auth,
// no DB round-trip — this only proves the Node process is up and serving.
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () =>
        Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } }),
    },
  },
});
