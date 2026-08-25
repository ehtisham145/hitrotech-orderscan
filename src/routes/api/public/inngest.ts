import { createFileRoute } from "@tanstack/react-router";
import { serve } from "inngest/edge";
import { inngest, extractImage, requeueStaleExtractions } from "@/lib/inngest.server";

const handler = serve({
  client: inngest,
  functions: [extractImage, requeueStaleExtractions],
  servePath: "/api/public/inngest",
});

export const Route = createFileRoute("/api/public/inngest")({
  server: {
    handlers: {
      GET: async ({ request }) => handler(request),
      POST: async ({ request }) => handler(request),
      PUT: async ({ request }) => handler(request),
    },
  },
});
