// Client-side observability: Sentry (errors) + PostHog (product analytics).
// Both keys below are public client keys by design.
const SENTRY_DSN =
  "https://61b6c227ab448b78ceec5eb1b6886805@o4511832017666048.ingest.us.sentry.io/4511832028282880";
const POSTHOG_KEY = "phx_w5uEDeHXfB2ijeuPHqm5hXsCXdn4YWH9ncCcP9aVh92pov4Y";
const POSTHOG_HOST = "https://us.i.posthog.com";

let started = false;

export async function initObservability() {
  if (started || typeof window === "undefined") return;
  started = true;

  try {
    const Sentry = await import("@sentry/react");
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
      replaysOnErrorSampleRate: 0,
      replaysSessionSampleRate: 0,
      sendDefaultPii: false,
    });
  } catch (err) {
    console.warn("[observability] Sentry init failed", err);
  }

  try {
    const { default: posthog } = await import("posthog-js");
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
    });
  } catch (err) {
    console.warn("[observability] PostHog init failed", err);
  }
}

export async function identifyUser(userId: string, traits?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    const [{ default: posthog }, Sentry] = await Promise.all([
      import("posthog-js"),
      import("@sentry/react"),
    ]);
    posthog.identify(userId, traits);
    Sentry.setUser({ id: userId });
  } catch {
    /* ignore */
  }
}

export async function resetUser() {
  if (typeof window === "undefined") return;
  try {
    const [{ default: posthog }, Sentry] = await Promise.all([
      import("posthog-js"),
      import("@sentry/react"),
    ]);
    posthog.reset();
    Sentry.setUser(null);
  } catch {
    /* ignore */
  }
}
