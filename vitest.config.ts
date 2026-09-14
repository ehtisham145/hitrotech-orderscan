// Standalone Vitest config — deliberately NOT extending vite.config.ts,
// which is wrapped by @lovable.dev/vite-tanstack-config (see that file's
// own comment: touching its defaults manually breaks the app with
// duplicate plugins). Vitest supports its own dedicated config file, so
// there's no need to go near that wrapper at all.
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Native tsconfig-paths resolution (this Vite version's replacement for
  // the vite-tsconfig-paths plugin) — resolves `@/lib/...` the same way
  // the real app does.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
