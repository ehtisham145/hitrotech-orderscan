// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Outside of Lovable's own build (i.e. when Vercel or our own VPS Docker
// build runs `vite build`), target the platform's runtime so /api/* server
// routes deploy as real functions instead of falling through to the SPA.
// Inside Lovable's build the preset is forced to Cloudflare regardless, so
// this only takes effect on Vercel / the VPS. NITRO_PRESET=node-server is
// set by the root Dockerfile for the VPS build.
//
// `inlineDynamicImports` is a real nitro/rollup option that the config
// package's public type does not declare, so the literal is cast rather than
// dropped: Rolldown's automatic server-chunk splitting produces a circular
// chunk pair for @tanstack/react-start's server-entry module (nitro 3 beta +
// vite 8/rolldown) that crashes at runtime with
// "TypeError: __exportAll is not a function". Inlining dynamic imports avoids
// the split entirely. Confirmed on both the VPS (node-server) build and
// Vercel's build, so it applies regardless of preset. Do not remove it.
const nitro = {
  preset: process.env.NITRO_PRESET || "vercel",
  inlineDynamicImports: true,
} as { preset?: string };

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro,
});

