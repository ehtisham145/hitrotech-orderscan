// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Outside of Lovable's own build (i.e. when Vercel or our own VPS Docker
  // build runs `vite build`), target the platform's runtime so /api/* server
  // routes deploy as real functions instead of falling through to the SPA.
  // Inside Lovable's build the preset is forced to Cloudflare regardless, so
  // this only takes effect on Vercel / the VPS. NITRO_PRESET=node-server is
  // set by the root Dockerfile for the VPS build.
  nitro: { preset: process.env.NITRO_PRESET || "vercel" },
});
