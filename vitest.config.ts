import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Match tsconfig's "@/*" → "./src/*" so tests can import app modules.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
