import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/** `npm run audit:results`: runs realistic searches over the real data and writes a report (scripts/audit). */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["scripts/audit/**/*.audit.ts"], testTimeout: 600_000 },
});
