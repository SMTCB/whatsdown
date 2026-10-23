import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Real provider calls. Run with `npm run test:live`; never part of `npm test` or CI. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["tests/live/**/*.live.ts"], environment: "node", testTimeout: 60_000 },
});
